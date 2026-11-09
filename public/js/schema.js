// The editable game configuration: defaults, limits and validation.
// Imported by the server (authoritative validation) and the admin UI (form limits),
// so a field only ever has to be described here.

export const MAPS = ['grid', 'forest', 'wasteland'];

export const GAME_MODES = ['rescue', 'endless'];

export const ROLES = ['player', 'companion', 'hostage', 'enemy1', 'enemy2', 'boss', 'enemy5', 'ball', 'jet', 'missile', 'rocketeer', 'rocket'];

/** Everything except projectiles, which have a texture and no name. */
export const NAMED_ROLES = ROLES.filter((role) => !['ball', 'missile', 'rocket'].includes(role));

// Only the wasteland has buses, and a Rocketeer has nowhere else to stand.
const BUS_MAP = 'wasteland';
const BUS_ROLES = ['rocketeer', 'rocket'];

/** The roles that exist on one map. */
export const mapRoles = (mapId) => ROLES.filter((role) => mapId === BUS_MAP || !BUS_ROLES.includes(role));

export const hasSigns = (mapId) => mapId === BUS_MAP;

export const ROLE_LABELS = {
  player: 'Player',
  companion: 'Player companion',
  hostage: 'Hostage',
  enemy1: 'Enemy 1 (strong, rare)',
  enemy2: 'Enemy 2 (weak, common)',
  boss: 'Enemy 3 (boss)',
  enemy5: 'Enemy 5 (strongest, rarest)',
  ball: 'Enemy 5 large ball',
  jet: 'Su-34 (image facing right)',
  missile: 'Kh-29 missile (image facing right)',
  rocketeer: 'Rocketeer (stands on the buses)',
  rocket: 'Rocketeer rocket (image facing right)',
};

const COMBAT = ['size', 'hp', 'speed', 'damage'];
export const ROLE_FIELDS = {
  player: [...COMBAT, 'fireInterval'],
  companion: ['enabled', ...COMBAT, 'fireInterval'],
  hostage: ['size'],
  enemy1: ['enabled', 'spawnChance', ...COMBAT, 'xp', 'attackType'],
  enemy2: ['enabled', 'spawnChance', ...COMBAT, 'xp', 'attackType'],
  boss: ['enabled', 'spawnChance', ...COMBAT, 'endlessXp', 'attackType'],
  enemy5: ['enabled', 'spawnChance', ...COMBAT, 'xp', 'fireInterval'],
  ball: ['size', 'speed', 'damage'],
  jet: ['enabled', 'spawnChance', 'size', 'hp', 'speed', 'xp', 'fireInterval'],
  missile: ['size', 'speed', 'damage'],
  rocketeer: ['enabled', 'spawnChance', 'size', 'hp', 'xp', 'fireInterval'],
  rocket: ['size', 'speed', 'damage'],
};

// Uploaded per map and role. There are no built-in sounds: an empty slot is silent.
export const SOUND_SLOTS = {
  player: ['shoot'],
  companion: ['idle', 'shoot'],
  hostage: ['idle'],
  enemy1: ['idle', 'shoot', 'impact'],
  enemy2: ['idle', 'shoot', 'impact'],
  boss: ['theme'],
  enemy5: ['idle', 'shoot'],
  jet: ['idle', 'shoot'],
  rocketeer: ['idle', 'shoot'],
};

export const SOUND_LABELS = {
  idle: 'Idle (loops while it is near)',
  shoot: 'Shoot (plays on each attack)',
  impact: 'Impact (kamikaze attack only)',
  theme: 'Theme song (loops while the boss is on screen)',
};

export const MAX_SOUND_BYTES = 16 * 1024 * 1024;
export const SOUND_FILE = /^[0-9a-f]{64}\.(?:wav|mp3)$/;

const REGULAR_ENEMIES = ['enemy1', 'enemy2', 'enemy5'];

export const CHARACTER_FIELDS = {
  enabled: { label: 'On this map', boolean: true },
  spawnChance: {
    label: 'Spawn chance (0 to 1)', min: 0, max: 1, step: 0.001,
    roleLabels: { boss: 'Spawn chance in Endless mode (0 to 1)', rocketeer: 'Chance a map area has a bus (0 to 1)' },
  },
  size: { label: 'Size (px)', min: 16, max: 220, step: 1 },
  hp: { label: 'Health', min: 1, max: 100000, step: 1 },
  speed: { label: 'Speed', min: 0, max: 800, step: 1 },
  damage: { label: 'Damage', min: 0, max: 5000, step: 1 },
  fireInterval: { label: 'Seconds between shots', min: 0.05, max: 5, step: 0.01 },
  xp: { label: 'XP dropped', min: 0, max: 100000, step: 1 },
  endlessXp: { label: 'XP dropped (Endless mode)', min: 0, max: 100000, step: 1 },
  attackType: {
    label: 'Attack type',
    options: ['melee', 'sniper', 'pump', 'kamikaze', 'boss'],
    optionLabels: {
      melee: 'Melee', sniper: 'Sniper (one bullet)', pump: 'Pump (spread)', kamikaze: 'Kamikaze (dies slamming into you)',
      boss: 'Boss attack (fan, ring and charge)',
    },
    notFor: { boss: ['kamikaze'] }, // the rescue is won by killing the boss, so it cannot blow itself up
  },
};

export const GAMEPLAY_FIELDS = {
  hostageDistance: { label: 'Hostage distance from start', min: 800, max: 40000, step: 50 },
  companionKills: { label: 'Kills before the companion joins', min: 0, max: 200, step: 1 },
  companionDistance: { label: 'Companion joins within this distance of the hostage', min: 300, max: 40000, step: 50 },
  hintSeconds: { label: 'Direction light duration (s)', min: 0.2, max: 10, step: 0.1 },
  hintSpread: { label: 'Direction light width (degrees)', min: 10, max: 170, step: 1 },
  difficultyKills: { label: 'Kills per difficulty level', min: 1, max: 10000, step: 1 },
  difficultyIncrease: { label: 'Enemy stat increase per level (%)', min: 0, max: 1000, step: 1 },
  attackRange: { label: 'Auto-attack range', min: 100, max: 1500, step: 10 },
  arenaRadius: { label: 'Boss arena radius', min: 250, max: 2000, step: 10 },
  xpToUpgrade: { label: 'XP needed for each upgrade', min: 1, max: 100000, step: 1 },
  upgradeDamage: { label: 'Damage upgrade (% of base damage)', min: 1, max: 5000, step: 1 },
  upgradeHealth: { label: 'Health added by the upgrade', min: 1, max: 100000, step: 1 },
  upgradeFireRate: { label: 'Fire rate upgrade (% faster)', min: 1, max: 1000, step: 1 },
};

// Set per map. How likely each character is lives on the character itself, as `spawnChance`.
export const SPAWN_FIELDS = {
  spawnInterval: { label: 'Seconds between enemy spawns', min: 0.1, max: 20, step: 0.05 },
  maxEnemies: { label: 'Most enemies at once', min: 1, max: 120, step: 1 },
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
export const MAX_SIGNS = 20;
export const MAX_SIGN_LENGTH = 48;

const NAMES = {
  grid: {
    map: 'The Grid', player: 'Runner', companion: 'Scout', hostage: 'Hostage',
    enemy1: 'Brute', enemy2: 'Stalker', boss: 'Warden', enemy5: 'Overseer', jet: 'Su-34',
  },
  forest: {
    map: 'Burnt Forest', player: 'Ranger', companion: 'Hound', hostage: 'Pilot',
    enemy1: 'Ironback', enemy2: 'Scavenger', boss: 'Tank Lord', enemy5: 'Colossus', jet: 'Su-34',
  },
  wasteland: {
    map: 'White Wasteland', player: 'Drifter', companion: 'Husky', hostage: 'Surveyor',
    enemy1: 'Frostback', enemy2: 'Scrapper', boss: 'Snow King', enemy5: 'Glacier', jet: 'Su-34', rocketeer: 'Rocketeer',
  },
};

const DEFAULT_SPAWNS = { spawnInterval: 1.15, maxEnemies: 36 };

const DEFAULT_SIGNS = ['TURN BACK', 'NO SIGNAL', 'LAST BUS LEFT YEARS AGO', 'DO NOT FEED THE ROCKETEERS', 'NOTHING AHEAD'];

function defaultCharacters(map) {
  const names = NAMES[map];
  const characters = {
    player: { name: names.player, sprite: null, size: 46, hp: 100, speed: 255, damage: 18, fireInterval: 0.26 },
    companion: { name: names.companion, sprite: null, enabled: true, size: 40, hp: 80, speed: 285, damage: 10, fireInterval: 0.4 },
    hostage: { name: names.hostage, sprite: null, size: 44 },
    enemy1: { name: names.enemy1, sprite: null, enabled: true, spawnChance: 0.14, size: 62, hp: 130, speed: 135, damage: 20, xp: 40, attackType: 'melee' },
    enemy2: { name: names.enemy2, sprite: null, enabled: true, spawnChance: 0.82, size: 36, hp: 32, speed: 180, damage: 8, xp: 10, attackType: 'melee' },
    boss: { name: names.boss, sprite: null, enabled: true, spawnChance: 0.005, size: 118, hp: 1500, speed: 120, damage: 13, endlessXp: 500, attackType: 'pump' },
    enemy5: { name: names.enemy5, sprite: null, enabled: true, spawnChance: 0.04, size: 96, hp: 650, speed: 90, damage: 30, xp: 150, fireInterval: 3 },
    ball: { sprite: null, size: 92, speed: 260, damage: 35 },
    jet: { name: names.jet, sprite: null, enabled: true, spawnChance: 0.015, size: 120, hp: 260, speed: 430, xp: 100, fireInterval: 1.4 },
    missile: { sprite: null, size: 46, speed: 300, damage: 40 },
    rocketeer: { name: names.rocketeer, sprite: null, enabled: true, spawnChance: 0.2, size: 54, hp: 140, xp: 60, fireInterval: 3.2 },
    rocket: { sprite: null, size: 42, speed: 260, damage: 28 },
  };
  const result = {};
  for (const role of mapRoles(map)) {
    result[role] = SOUND_SLOTS[role] ? { ...characters[role], sounds: {} } : characters[role];
  }
  return result;
}

/** The settings one game runs with: the shared rules plus that map's characters. */
export function mapConfig(config, mapId) {
  const map = config.maps[mapId];
  return { site: config.site, gameplay: { ...config.gameplay, ...map.spawns }, mapId, name: map.name, characters: map.characters, signs: map.signs ?? [] };
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
    maps: Object.fromEntries(MAPS.map((map) => [map, {
      name: NAMES[map].map,
      characters: defaultCharacters(map),
      spawns: { ...DEFAULT_SPAWNS },
      ...(hasSigns(map) ? { signs: [...DEFAULT_SIGNS] } : {}),
    }])),
    gameplay: {
      hostageDistance: 5200,
      companionKills: 8,
      companionDistance: 1500,
      hintSeconds: 1.4,
      hintSpread: 55,
      difficultyKills: 25,
      difficultyIncrease: 10,
      attackRange: 450,
      arenaRadius: 560,
      xpToUpgrade: 200,
      upgradeDamage: 20,
      upgradeHealth: 20,
      upgradeFireRate: 20,
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

function readSpawns(input, path, errors) {
  const spawns = isObject(input) ? input : {};
  if (!isObject(input)) errors.push(`${path}: is required`);
  checkKeys(spawns, Object.keys(SPAWN_FIELDS), path, errors);
  return Object.fromEntries(Object.entries(SPAWN_FIELDS).map(([key, spec]) => [key, readNumber(spawns[key], `${path}.${key}`, spec, errors)]));
}

function readSigns(input, path, errors) {
  if (!Array.isArray(input)) {
    errors.push(`${path}: must be a list`);
    return [];
  }
  if (input.length > MAX_SIGNS) errors.push(`${path}: at most ${MAX_SIGNS} signs`);
  return input.map((text, index) => readText(text, `${path}.${index}`, MAX_SIGN_LENGTH, true, errors));
}

/** The attack types an admin may pick for this role. */
export const attackOptions = (role) => {
  const spec = CHARACTER_FIELDS.attackType;
  return spec.options.filter((option) => !spec.notFor[role]?.includes(option));
};

function readCharacters(input, mapId, path, errors) {
  const roles = mapRoles(mapId);
  const characters = isObject(input) ? input : {};
  if (!isObject(input)) errors.push(`${path}: is required`);
  checkKeys(characters, roles, path, errors);
  const out = {};
  for (const role of roles) {
    const where = `${path}.${role}`;
    const ch = isObject(characters[role]) ? characters[role] : {};
    if (!isObject(characters[role])) errors.push(`${where}: is required`);
    const named = NAMED_ROLES.includes(role);
    checkKeys(ch, [...(named ? ['name'] : []), ...ROLE_FIELDS[role]], where, errors);
    const clean = named ? { name: readText(ch.name, `${where}.name`, MAX_NAME_LENGTH, true, errors) } : {};
    for (const field of ROLE_FIELDS[role]) {
      const spec = CHARACTER_FIELDS[field];
      if (spec.boolean) {
        if (typeof ch[field] !== 'boolean') errors.push(`${where}.${field}: must be on or off`);
        clean[field] = ch[field];
      } else if (spec.options) {
        if (!attackOptions(role).includes(ch[field])) errors.push(`${where}.${field}: invalid choice`);
        clean[field] = ch[field];
      } else {
        clean[field] = readNumber(ch[field], `${where}.${field}`, spec, errors);
      }
    }
    out[role] = clean;
  }
  // Direction hints come from kills, so a map with nothing to kill could never be finished.
  if (!REGULAR_ENEMIES.some((role) => out[role].enabled !== false && out[role].spawnChance > 0)) {
    errors.push(`${path}: keep at least one of Enemy 1, Enemy 2 or Enemy 5 on, with a spawn chance above 0`);
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
    checkKeys(map, ['name', 'characters', 'spawns', ...(hasSigns(mapId) ? ['signs'] : [])], path, errors);
    value.maps[mapId] = {
      name: readText(map.name, `${path}.name`, MAX_MAP_NAME_LENGTH, true, errors),
      characters: readCharacters(map.characters, mapId, `${path}.characters`, errors),
      spawns: readSpawns(map.spawns, `${path}.spawns`, errors),
    };
    if (hasSigns(mapId)) value.maps[mapId].signs = readSigns(map.signs, `${path}.signs`, errors);
  }

  const gameplay = isObject(input.gameplay) ? input.gameplay : {};
  if (!isObject(input.gameplay)) errors.push('gameplay: is required');
  checkKeys(gameplay, Object.keys(GAMEPLAY_FIELDS), 'gameplay', errors);
  for (const [key, spec] of Object.entries(GAMEPLAY_FIELDS)) {
    value.gameplay[key] = readNumber(gameplay[key], `gameplay.${key}`, spec, errors);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}
