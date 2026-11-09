// Persists the config as one JSON file and sprites as content-addressed PNGs in the data volume.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAPS, NAMED_ROLES, ROLES, ROLE_FIELDS, SPRITE_HASH, defaultConfig, validateConfig } from '../public/js/schema.js';

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
    for (const role of ROLES) {
      const stored = config.maps[mapId].characters[role];
      characters[role] = NAMED_ROLES.includes(role) ? { name: stored.name } : {};
      for (const field of ROLE_FIELDS[role]) characters[role][field] = stored[field];
    }
    maps[mapId] = { name: config.maps[mapId].name, characters };
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
    for (const role of ROLES) characters[role] = { ...base.maps[mapId].characters[role], ...map?.characters?.[role] };
    merged.maps[mapId] = { name: map?.name ?? base.maps[mapId].name, characters };
  }
  // Before there were two joysticks the single one could be centred.
  if (merged.site.joystickSide === 'center') merged.site.joystickSide = 'left';
  return merged;
}

export class Store {
  constructor(dataDir, log = console) {
    this.file = path.join(dataDir, 'config.json');
    this.spriteDir = path.join(dataDir, 'sprites');
    this.log = log;
    fs.mkdirSync(this.spriteDir, { recursive: true });
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
      for (const mapId of MAPS) {
        for (const role of ROLES) {
          const sprite = config.maps[mapId].characters[role].sprite;
          result.value.maps[mapId].characters[role].sprite = SPRITE_HASH.test(sprite ?? '') ? sprite : null;
        }
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
    this.#removeUnusedSprites();
    return this.state;
  }

  #removeUnusedSprites() {
    const used = new Set(MAPS.flatMap((mapId) => ROLES.map((role) => this.state.config.maps[mapId].characters[role].sprite)));
    for (const name of fs.readdirSync(this.spriteDir)) {
      if (!used.has(name.replace(/\.png$/, ''))) fs.rmSync(path.join(this.spriteDir, name), { force: true });
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
    for (const mapId of MAPS) {
      for (const role of ROLES) {
        const ch = config.maps[mapId].characters[role];
        ch.spriteUrl = ch.sprite ? `/sprites/${ch.sprite}.png` : null;
        delete ch.sprite;
      }
    }
    return { revision, ...config };
  }

  /** Replaces editable fields. Sprites are carried over untouched. */
  replace(value) {
    const next = structuredClone(value);
    for (const mapId of MAPS) {
      for (const role of ROLES) next.maps[mapId].characters[role].sprite = this.state.config.maps[mapId].characters[role].sprite;
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

  readSprite(hash) {
    if (!SPRITE_HASH.test(hash)) return null;
    try {
      return fs.readFileSync(path.join(this.spriteDir, `${hash}.png`));
    } catch {
      return null;
    }
  }
}
