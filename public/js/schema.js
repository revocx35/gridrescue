// The editable game configuration: defaults, limits and validation.
// Imported by the server (authoritative validation) and the admin UI (form limits),
// so a field only ever has to be described here.

export const MAPS = ['grid', 'forest'];

export const ROLES = ['player', 'companion', 'hostage', 'enemy1', 'enemy2', 'boss', 'enemy5', 'ball'];

/** Everything except the ball, which is a projectile with a texture and no name. */
export const NAMED_ROLES = ROLES.filter((role) => role !== 'ball');

export const ROLE_LABELS = {
  player: 'Player',
  companion: 'Player companion',
  hostage: 'Hostage',
  enemy1: 'Enemy 1 (strong, rare)',
  enemy2: 'Enemy 2 (weak, common)',
  boss: 'Enemy 3 (boss)',
  enemy5: 'Enemy 5 (strongest, rarest)',
  ball: 'Enemy 5 large ball',
};

const COMBAT = ['size', 'hp', 'speed', 'damage'];
export const ROLE_FIELDS = {
  player: [...COMBAT, 'fireInterval'],
  companion: [...COMBAT, 'fireInterval'],
  hostage: ['size'],
  enemy1: [...COMBAT, 'xp', 'attackType'],
  enemy2: [...COMBAT, 'xp', 'attackType'],
  boss: [...COMBAT, 'attackType'],
  enemy5: [...COMBAT, 'xp', 'fireInterval'],
  ball: ['size', 'speed', 'damage'],
};

export const CHARACTER_FIELDS = {
  size: { label: 'Size (px)', min: 16, max: 220, step: 1 },
  hp: { label: 'Health', min: 1, max: 100000, step: 1 },
  speed: { label: 'Speed', min: 0, max: 800, step: 1 },
  damage: { label: 'Damage', min: 0, max: 5000, step: 1 },
  fireInterval: { label: 'Seconds between shots', min: 0.05, max: 5, step: 0.01 },
  xp: { label: 'XP dropped', min: 0, max: 100000, step: 1 },
  attackType: {
    label: 'Attack type',
    options: ['melee', 'sniper', 'pump'],
    optionLabels: { melee: 'Melee', sniper: 'Sniper (one bullet)', pump: 'Pump (spread)' },
  },
};

export const GAMEPLAY_FIELDS = {
  hostageDistance: { label: 'Hostage distance from start', min: 800, max: 40000, step: 50 },
  companionKills: { label: 'Kills before the companion joins', min: 0, max: 200, step: 1 },
  companionDistance: { label: 'Companion joins within this distance of the hostage', min: 300, max: 40000, step: 50 },
  hintSeconds: { label: 'Direction light duration (s)', min: 0.2, max: 10, step: 0.1 },
  hintSpread: { label: 'Direction light width (degrees)', min: 10, max: 170, step: 1 },
  spawnInterval: { label: 'Seconds between enemy spawns', min: 0.1, max: 20, step: 0.05 },
  enemy1Chance: { label: 'Chance a spawn is Enemy 1 (0 to 1)', min: 0, max: 1, step: 0.01 },
  enemy5Chance: { label: 'Chance a spawn is Enemy 5 (0 to 1)', min: 0, max: 1, step: 0.01 },
  maxEnemies: { label: 'Most enemies at once', min: 1, max: 120, step: 1 },
  attackRange: { label: 'Auto-attack range', min: 100, max: 1500, step: 10 },
  arenaRadius: { label: 'Boss arena radius', min: 250, max: 2000, step: 10 },
  xpToUpgrade: { label: 'XP needed for each upgrade', min: 1, max: 100000, step: 1 },
  upgradeDamage: { label: 'Damage upgrade (% of base damage)', min: 1, max: 5000, step: 1 },
  upgradeHealth: { label: 'Health added by the upgrade', min: 1, max: 100000, step: 1 },
};

export const SITE_TEXT_FIELDS = {
  title: { label: 'Game title', max: 60, required: true },
  tagline: { label: 'Tagline under the title', max: 120, required: false },
  startLabel: { label: 'Start button', max: 24, required: true },
  winText: { label: 'Victory message', max: 160, required: true },
  loseText: { label: 'Defeat message', max: 160, required: true },
};

export const SITE_COLOR_FIELDS = {
  background: 'Page background',
  floor: 'Grid floor',
  grid: 'Grid lines',
  text: 'Text (tagline, status bar)',
  accent: 'Title and button, start colour',
  accent2: 'Title and button, end colour',
};

export const SITE_NUMBER_FIELDS = {
  titleSizeDesktop: { label: 'Title size, desktop (px)', min: 14, max: 120, step: 1 },
  titleSizeMobile: { label: 'Title size, mobile (px)', min: 12, max: 72, step: 1 },
  joystickSize: { label: 'Joystick size (px)', min: 90, max: 240, step: 1 },
};

export const SITE_CHOICE_FIELDS = {
  titleAlign: { label: 'Title alignment', options: ['left', 'center', 'right'] },
  joystickSide: { label: 'Movement joystick side', options: ['left', 'right'] },
};

export const ORDER_FIELDS = {
  desktopOrder: { label: 'Desktop page order', items: ['title', 'game'] },
  mobileOrder: { label: 'Mobile page order', items: ['title', 'game', 'joystick'] },
};

export const ORDER_LABELS = { title: 'Game title', game: 'Game', joystick: 'Joystick controls' };

export const MAX_NAME_LENGTH = 32;
export const MAX_MAP_NAME_LENGTH = 32;

const NAMES = {
  grid: {
    map: 'The Grid', player: 'Runner', companion: 'Scout', hostage: 'Hostage',
    enemy1: 'Brute', enemy2: 'Stalker', boss: 'Warden', enemy5: 'Overseer',
  },
  forest: {
    map: 'Burnt Forest', player: 'Ranger', companion: 'Hound', hostage: 'Pilot',
    enemy1: 'Ironback', enemy2: 'Scavenger', boss: 'Tank Lord', enemy5: 'Colossus',
  },
};

function defaultCharacters(map) {
  const names = NAMES[map];
  return {
    player: { name: names.player, sprite: null, size: 46, hp: 100, speed: 255, damage: 18, fireInterval: 0.26 },
    companion: { name: names.companion, sprite: null, size: 40, hp: 80, speed: 285, damage: 10, fireInterval: 0.4 },
    hostage: { name: names.hostage, sprite: null, size: 44 },
    enemy1: { name: names.enemy1, sprite: null, size: 62, hp: 130, speed: 135, damage: 20, xp: 40, attackType: 'melee' },
    enemy2: { name: names.enemy2, sprite: null, size: 36, hp: 32, speed: 180, damage: 8, xp: 10, attackType: 'melee' },
    boss: { name: names.boss, sprite: null, size: 118, hp: 1500, speed: 120, damage: 13, attackType: 'pump' },
    enemy5: { name: names.enemy5, sprite: null, size: 96, hp: 650, speed: 90, damage: 30, xp: 150, fireInterval: 3 },
    ball: { sprite: null, size: 92, speed: 260, damage: 35 },
  };
}

/** The settings one game runs with: the shared rules plus that map's characters. */
export function mapConfig(config, mapId) {
  const map = config.maps[mapId];
  return { site: config.site, gameplay: config.gameplay, mapId, name: map.name, characters: map.characters };
}

export function defaultConfig() {
  return {
    site: {
      title: 'Grid Rescue',
      tagline: '',
      startLabel: 'Start',
      winText: 'Rescued. You brought them home.',
      loseText: 'You were overrun.',
      titleAlign: 'center',
      joystickSide: 'left',
      titleSizeDesktop: 48,
      titleSizeMobile: 28,
      joystickSize: 150,
      desktopOrder: ['title', 'game'],
      mobileOrder: ['title', 'game', 'joystick'],
      colors: {
        background: '#07090d',
        floor: '#0d1219',
        grid: '#1f2a36',
        text: '#e8eef5',
        accent: '#39e0c2',
        accent2: '#ffb347',
      },
    },
    maps: Object.fromEntries(MAPS.map((map) => [map, { name: NAMES[map].map, characters: defaultCharacters(map) }])),
    gameplay: {
      hostageDistance: 5200,
      companionKills: 8,
      companionDistance: 1500,
      hintSeconds: 1.4,
      hintSpread: 55,
      spawnInterval: 1.15,
      enemy1Chance: 0.14,
      enemy5Chance: 0.04,
      maxEnemies: 36,
      attackRange: 450,
      arenaRadius: 560,
      xpToUpgrade: 200,
      upgradeDamage: 20,
      upgradeHealth: 20,
    },
  };
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const COLOR = /^#[0-9a-f]{6}$/i;
export const SPRITE_HASH = /^[0-9a-f]{64}$/;

// Zero-width and direction-override characters would let a public name disguise itself or flip a row.
const INVISIBLE_CHARS = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

export const MAX_SCORE_NAME_LENGTH = 20;

/** The name to show on the leaderboard, or null if it cannot be used. */
export function cleanScoreName(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim();
  const usable = name && name.length <= MAX_SCORE_NAME_LENGTH && !CONTROL_CHARS.test(name) && !INVISIBLE_CHARS.test(name);
  return usable ? name : null;
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkKeys(obj, allowed, path, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown field`);
  }
}

function readText(value, path, max, required, errors) {
  if (typeof value !== 'string') {
    errors.push(`${path}: must be text`);
    return '';
  }
  const text = value.trim();
  if (required && !text) errors.push(`${path}: is required`);
  if (text.length > max) errors.push(`${path}: at most ${max} characters`);
  if (CONTROL_CHARS.test(text)) errors.push(`${path}: contains control characters`);
  return text;
}

function readNumber(value, path, spec, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}: must be a number`);
    return spec.min;
  }
  if (value < spec.min || value > spec.max) errors.push(`${path}: must be between ${spec.min} and ${spec.max}`);
  return value;
}

function readCharacters(input, path, errors) {
  const characters = isObject(input) ? input : {};
  if (!isObject(input)) errors.push(`${path}: is required`);
  checkKeys(characters, ROLES, path, errors);
  const out = {};
  for (const role of ROLES) {
    const where = `${path}.${role}`;
    const ch = isObject(characters[role]) ? characters[role] : {};
    if (!isObject(characters[role])) errors.push(`${where}: is required`);
    const named = NAMED_ROLES.includes(role);
    checkKeys(ch, [...(named ? ['name'] : []), ...ROLE_FIELDS[role]], where, errors);
    const clean = named ? { name: readText(ch.name, `${where}.name`, MAX_NAME_LENGTH, true, errors) } : {};
    for (const field of ROLE_FIELDS[role]) {
      const spec = CHARACTER_FIELDS[field];
      if (spec.options) {
        if (!spec.options.includes(ch[field])) errors.push(`${where}.${field}: invalid choice`);
        clean[field] = ch[field];
      } else {
        clean[field] = readNumber(ch[field], `${where}.${field}`, spec, errors);
      }
    }
    out[role] = clean;
  }
  return out;
}

/**
 * Validates an admin-submitted config (site, maps with their characters, gameplay). Sprites are managed through
 * their own upload endpoint, so a `sprite` key is rejected here like any other unknown field.
 * Returns { ok: true, value } or { ok: false, errors }.
 */
export function validateConfig(input) {
  const errors = [];
  const value = { site: { colors: {} }, maps: {}, gameplay: {} };
  if (!isObject(input)) return { ok: false, errors: ['config: must be an object'] };
  checkKeys(input, ['site', 'maps', 'gameplay'], 'config', errors);

  const site = isObject(input.site) ? input.site : {};
  if (!isObject(input.site)) errors.push('site: is required');
  checkKeys(
    site,
    [
      ...Object.keys(SITE_TEXT_FIELDS),
      ...Object.keys(SITE_NUMBER_FIELDS),
      ...Object.keys(SITE_CHOICE_FIELDS),
      ...Object.keys(ORDER_FIELDS),
      'colors',
    ],
    'site',
    errors,
  );
  for (const [key, spec] of Object.entries(SITE_TEXT_FIELDS)) {
    value.site[key] = readText(site[key], `site.${key}`, spec.max, spec.required, errors);
  }
  for (const [key, spec] of Object.entries(SITE_NUMBER_FIELDS)) {
    value.site[key] = readNumber(site[key], `site.${key}`, spec, errors);
  }
  for (const [key, spec] of Object.entries(SITE_CHOICE_FIELDS)) {
    if (!spec.options.includes(site[key])) errors.push(`site.${key}: invalid choice`);
    value.site[key] = site[key];
  }
  for (const [key, spec] of Object.entries(ORDER_FIELDS)) {
    const order = site[key];
    const valid =
      Array.isArray(order) &&
      order.length === spec.items.length &&
      spec.items.every((item) => order.includes(item));
    if (!valid) errors.push(`site.${key}: must list each section once`);
    value.site[key] = valid ? [...order] : [...spec.items];
  }
  const colors = isObject(site.colors) ? site.colors : {};
  if (!isObject(site.colors)) errors.push('site.colors: is required');
  checkKeys(colors, Object.keys(SITE_COLOR_FIELDS), 'site.colors', errors);
  for (const key of Object.keys(SITE_COLOR_FIELDS)) {
    if (typeof colors[key] !== 'string' || !COLOR.test(colors[key])) {
      errors.push(`site.colors.${key}: must be a #rrggbb colour`);
    }
    value.site.colors[key] = String(colors[key]).toLowerCase();
  }

  const maps = isObject(input.maps) ? input.maps : {};
  if (!isObject(input.maps)) errors.push('maps: is required');
  checkKeys(maps, MAPS, 'maps', errors);
  for (const mapId of MAPS) {
    const path = `maps.${mapId}`;
    const map = isObject(maps[mapId]) ? maps[mapId] : {};
    if (!isObject(maps[mapId])) errors.push(`${path}: is required`);
    checkKeys(map, ['name', 'characters'], path, errors);
    value.maps[mapId] = {
      name: readText(map.name, `${path}.name`, MAX_MAP_NAME_LENGTH, true, errors),
      characters: readCharacters(map.characters, `${path}.characters`, errors),
    };
  }

  const gameplay = isObject(input.gameplay) ? input.gameplay : {};
  if (!isObject(input.gameplay)) errors.push('gameplay: is required');
  checkKeys(gameplay, Object.keys(GAMEPLAY_FIELDS), 'gameplay', errors);
  for (const [key, spec] of Object.entries(GAMEPLAY_FIELDS)) {
    value.gameplay[key] = readNumber(gameplay[key], `gameplay.${key}`, spec, errors);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}
