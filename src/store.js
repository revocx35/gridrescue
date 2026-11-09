// Persists the config as one JSON file and sprites as content-addressed PNGs in the data volume.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAPS, NAMED_ROLES, ROLE_FIELDS, SOUND_FILE, SOUND_SLOTS, SPRITE_HASH, defaultConfig, hasSigns, mapRoles, validateConfig } from '../public/js/schema.js';

export function writeAtomic(file, data) {
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o640);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function withEditableFields(config) {
  const maps = {};
  for (const mapId of MAPS) {
    const characters = {};
    for (const role of mapRoles(mapId)) {
      const stored = config.maps[mapId].characters[role];
      characters[role] = NAMED_ROLES.includes(role) ? { name: stored.name } : {};
      for (const field of ROLE_FIELDS[role]) characters[role][field] = stored[field];
    }
    maps[mapId] = { name: config.maps[mapId].name, characters };
    if (hasSigns(mapId)) maps[mapId].signs = config.maps[mapId].signs;
  }
  return { site: config.site, maps, gameplay: config.gameplay };
}

/** Configs from before maps existed: their characters become the first map. */
function mapsFromFlatConfig(stored) {
  const characters = structuredClone(stored.characters ?? {});
  const { enemy1, enemy2 } = characters;
  // The first XP defaults gave the stronger enemy less; an untouched pair moves to the corrected values.
  if (enemy1?.xp === 10 && enemy2?.xp === 40) {
    enemy1.xp = 40;
    enemy2.xp = 10;
  }
  return { [MAPS[0]]: { characters } };
}

/** Fills fields added by newer versions with their defaults. */
function upgrade(stored) {
  const base = defaultConfig();
  const storedMaps = stored.maps ?? mapsFromFlatConfig(stored);
  const merged = {
    site: { ...base.site, ...stored.site, colors: { ...base.site.colors, ...stored.site?.colors } },
    gameplay: { ...base.gameplay, ...stored.gameplay },
    maps: {},
  };
  for (const mapId of MAPS) {
    const map = storedMaps[mapId];
    const characters = {};
    for (const role of mapRoles(mapId)) characters[role] = { ...base.maps[mapId].characters[role], ...map?.characters?.[role] };
    merged.maps[mapId] = { name: map?.name ?? base.maps[mapId].name, characters };
    if (hasSigns(mapId)) merged.maps[mapId].signs = map?.signs ?? base.maps[mapId].signs;
  }
  // Before there were two joysticks the single one could be centred.
  if (merged.site.joystickSide === 'center') merged.site.joystickSide = 'left';
  return merged;
}

/** Every [mapId, role, character] in a config. */
function* eachCharacter(config) {
  for (const mapId of MAPS) {
    for (const role of mapRoles(mapId)) yield [mapId, role, config.maps[mapId].characters[role]];
  }
}

/** The stored sounds worth keeping: known slots holding well-formed file names. */
function validSounds(role, sounds) {
  return Object.fromEntries((SOUND_SLOTS[role] ?? []).filter((slot) => SOUND_FILE.test(sounds?.[slot] ?? '')).map((slot) => [slot, sounds[slot]]));
}

export class Store {
  constructor(dataDir, log = console) {
    this.file = path.join(dataDir, 'config.json');
    this.spriteDir = path.join(dataDir, 'sprites');
    this.soundDir = path.join(dataDir, 'sounds');
    this.log = log;
    fs.mkdirSync(this.spriteDir, { recursive: true });
    fs.mkdirSync(this.soundDir, { recursive: true });
    this.state = this.#load();
  }

  #load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return { revision: 1, config: defaultConfig() };
    }
    try {
      const parsed = JSON.parse(raw);
      const config = upgrade(parsed.config);
      const result = validateConfig(withEditableFields(config));
      if (!result.ok) throw new Error(result.errors.join('; '));
      for (const [mapId, role, stored] of eachCharacter(config)) {
        const clean = result.value.maps[mapId].characters[role];
        clean.sprite = SPRITE_HASH.test(stored.sprite ?? '') ? stored.sprite : null;
        if (SOUND_SLOTS[role]) clean.sounds = validSounds(role, stored.sounds);
      }
      return { revision: Number(parsed.revision) || 1, config: result.value };
    } catch (err) {
      const aside = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, aside);
      this.log.error({ err: err.message, aside }, 'config file was unreadable; moved aside, using defaults');
      return { revision: 1, config: defaultConfig() };
    }
  }

  #commit(config) {
    this.state = { revision: this.state.revision + 1, config };
    writeAtomic(this.file, JSON.stringify(this.state, null, 2));
    this.#removeUnusedFiles();
    return this.state;
  }

  #removeUnusedFiles() {
    const characters = [...eachCharacter(this.state.config)].map(([, , ch]) => ch);
    const sprites = new Set(characters.map((ch) => ch.sprite));
    for (const name of fs.readdirSync(this.spriteDir)) {
      if (!sprites.has(name.replace(/\.png$/, ''))) fs.rmSync(path.join(this.spriteDir, name), { force: true });
    }
    const sounds = new Set(characters.flatMap((ch) => Object.values(ch.sounds ?? {})));
    for (const name of fs.readdirSync(this.soundDir)) {
      if (!sounds.has(name)) fs.rmSync(path.join(this.soundDir, name), { force: true });
    }
  }

  get revision() {
    return this.state.revision;
  }

  /** The admin's view: everything, including revision for optimistic locking. */
  snapshot() {
    return structuredClone(this.state);
  }

  /** What the public game loads. Sprite hashes become cache-busting URLs. */
  publicConfig() {
    const { revision, config } = this.snapshot();
    for (const [, , ch] of eachCharacter(config)) {
      ch.spriteUrl = ch.sprite ? `/sprites/${ch.sprite}.png` : null;
      delete ch.sprite;
      ch.soundUrls = Object.fromEntries(Object.entries(ch.sounds ?? {}).map(([slot, file]) => [slot, `/sounds/${file}`]));
      delete ch.sounds;
    }
    return { revision, ...config };
  }

  /** Replaces editable fields. Sprites and sounds are carried over untouched. */
  replace(value) {
    const next = structuredClone(value);
    for (const [mapId, role, current] of eachCharacter(this.state.config)) {
      const ch = next.maps[mapId].characters[role];
      ch.sprite = current.sprite;
      if (current.sounds) ch.sounds = current.sounds;
    }
    return this.#commit(next);
  }

  /** Restores defaults for everything, including sprites. */
  reset() {
    return this.#commit(defaultConfig());
  }

  setSprite(mapId, role, png) {
    const hash = crypto.createHash('sha256').update(png).digest('hex');
    writeAtomic(path.join(this.spriteDir, `${hash}.png`), png);
    const next = structuredClone(this.state.config);
    next.maps[mapId].characters[role].sprite = hash;
    return this.#commit(next);
  }

  clearSprite(mapId, role) {
    const next = structuredClone(this.state.config);
    next.maps[mapId].characters[role].sprite = null;
    return this.#commit(next);
  }

  setSound(mapId, role, slot, { bytes, extension }) {
    const file = `${crypto.createHash('sha256').update(bytes).digest('hex')}.${extension}`;
    writeAtomic(path.join(this.soundDir, file), bytes);
    const next = structuredClone(this.state.config);
    next.maps[mapId].characters[role].sounds[slot] = file;
    return this.#commit(next);
  }

  clearSound(mapId, role, slot) {
    const next = structuredClone(this.state.config);
    delete next.maps[mapId].characters[role].sounds[slot];
    return this.#commit(next);
  }

  readSound(file) {
    if (!SOUND_FILE.test(file)) return null;
    try {
      return fs.readFileSync(path.join(this.soundDir, file));
    } catch {
      return null;
    }
  }

  readSprite(hash) {
    if (!SPRITE_HASH.test(hash)) return null;
    try {
      return fs.readFileSync(path.join(this.spriteDir, `${hash}.png`));
    } catch {
      return null;
    }
  }
}
