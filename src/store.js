// Persists the config as one JSON file and sprites as content-addressed PNGs in the data volume.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROLES, ROLE_FIELDS, SPRITE_HASH, defaultConfig, validateConfig } from '../public/js/schema.js';

function writeAtomic(file, data) {
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
  const characters = {};
  for (const role of ROLES) {
    characters[role] = { name: config.characters[role].name };
    for (const field of ROLE_FIELDS[role]) characters[role][field] = config.characters[role][field];
  }
  return { site: config.site, characters, gameplay: config.gameplay };
}

/** Fills fields added by newer versions with their defaults. */
function upgrade(stored) {
  const base = defaultConfig();
  const merged = {
    site: { ...base.site, ...stored.site, colors: { ...base.site.colors, ...stored.site?.colors } },
    gameplay: { ...base.gameplay, ...stored.gameplay },
    characters: {},
  };
  for (const role of ROLES) merged.characters[role] = { ...base.characters[role], ...stored.characters?.[role] };
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
      for (const role of ROLES) {
        const sprite = config.characters[role].sprite;
        result.value.characters[role].sprite = SPRITE_HASH.test(sprite ?? '') ? sprite : null;
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
    const used = new Set(ROLES.map((role) => this.state.config.characters[role].sprite));
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
    for (const role of ROLES) {
      const ch = config.characters[role];
      ch.spriteUrl = ch.sprite ? `/sprites/${ch.sprite}.png` : null;
      delete ch.sprite;
    }
    return { revision, ...config };
  }

  /** Replaces editable fields. Sprites are carried over untouched. */
  replace(value) {
    const next = structuredClone(value);
    for (const role of ROLES) next.characters[role].sprite = this.state.config.characters[role].sprite;
    return this.#commit(next);
  }

  /** Restores defaults for everything, including sprites. */
  reset() {
    return this.#commit(defaultConfig());
  }

  setSprite(role, png) {
    const hash = crypto.createHash('sha256').update(png).digest('hex');
    writeAtomic(path.join(this.spriteDir, `${hash}.png`), png);
    const next = structuredClone(this.state.config);
    next.characters[role].sprite = hash;
    return this.#commit(next);
  }

  clearSprite(role) {
    const next = structuredClone(this.state.config);
    next.characters[role].sprite = null;
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
