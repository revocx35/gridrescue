// The editable game configuration: defaults, limits and validation.
// Imported by the server (authoritative validation) and the admin UI (form limits),
// so a field only ever has to be described here.

export const ROLES = ['player', 'companion', 'hostage', 'enemy1', 'enemy2', 'boss'];

export const ROLE_LABELS = {
  player: 'Player',
  companion: 'Player companion',
  hostage: 'Hostage',
  enemy1: 'Enemy 1 (strong, rare)',
  enemy2: 'Enemy 2 (weak, common)',
  boss: 'Enemy 3 (boss)',
};

const COMBAT = ['size', 'hp', 'speed', 'damage'];
export const ROLE_FIELDS = {
  player: [...COMBAT, 'fireInterval'],
  companion: [...COMBAT, 'fireInterval'],
  hostage: ['size'],
  enemy1: [...COMBAT, 'xp', 'attackType'],
  enemy2: [...COMBAT, 'xp', 'attackType'],
  boss: [...COMBAT, 'attackType'],
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
  maxEnemies: { label: 'Most enemies at once', min: 1, max: 120, step: 1 },
  attackRange: { label: 'Auto-attack range', min: 100, max: 1500, step: 10 },
  arenaRadius: { label: 'Boss arena radius', min: 250, max: 2000, step: 10 },
  xpToUpgrade: { label: 'XP needed for each upgrade', min: 1, max: 100000, step: 1 },
  upgradeDamage: { label: 'Damage added by the upgrade', min: 1, max: 5000, step: 1 },
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
    characters: {
      player: { name: 'Runner', sprite: null, size: 46, hp: 100, speed: 255, damage: 18, fireInterval: 0.26 },
      companion: { name: 'Scout', sprite: null, size: 40, hp: 80, speed: 285, damage: 10, fireInterval: 0.4 },
      hostage: { name: 'Hostage', sprite: null, size: 44 },
      enemy1: { name: 'Brute', sprite: null, size: 62, hp: 130, speed: 135, damage: 20, xp: 10, attackType: 'melee' },
      enemy2: { name: 'Stalker', sprite: null, size: 36, hp: 32, speed: 180, damage: 8, xp: 40, attackType: 'melee' },
      boss: { name: 'Warden', sprite: null, size: 118, hp: 1500, speed: 120, damage: 13, attackType: 'pump' },
    },
    gameplay: {
      hostageDistance: 5200,
      companionKills: 8,
      companionDistance: 1500,
      hintSeconds: 1.4,
      hintSpread: 55,
      spawnInterval: 1.15,
      enemy1Chance: 0.14,
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

/**
 * Validates an admin-submitted config (site, characters, gameplay). Sprites are managed through
 * their own upload endpoint, so a `sprite` key is rejected here like any other unknown field.
 * Returns { ok: true, value } or { ok: false, errors }.
 */
export function validateConfig(input) {
  const errors = [];
  const value = { site: { colors: {} }, characters: {}, gameplay: {} };
  if (!isObject(input)) return { ok: false, errors: ['config: must be an object'] };
  checkKeys(input, ['site', 'characters', 'gameplay'], 'config', errors);

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

  const characters = isObject(input.characters) ? input.characters : {};
  if (!isObject(input.characters)) errors.push('characters: is required');
  checkKeys(characters, ROLES, 'characters', errors);
  for (const role of ROLES) {
    const ch = isObject(characters[role]) ? characters[role] : {};
    if (!isObject(characters[role])) errors.push(`characters.${role}: is required`);
    checkKeys(ch, ['name', ...ROLE_FIELDS[role]], `characters.${role}`, errors);
    const out = { name: readText(ch.name, `characters.${role}.name`, MAX_NAME_LENGTH, true, errors) };
    for (const field of ROLE_FIELDS[role]) {
      const spec = CHARACTER_FIELDS[field];
      if (spec.options) {
        if (!spec.options.includes(ch[field])) errors.push(`characters.${role}.${field}: invalid choice`);
        out[field] = ch[field];
      } else {
        out[field] = readNumber(ch[field], `characters.${role}.${field}`, spec, errors);
      }
    }
    value.characters[role] = out;
  }

  const gameplay = isObject(input.gameplay) ? input.gameplay : {};
  if (!isObject(input.gameplay)) errors.push('gameplay: is required');
  checkKeys(gameplay, Object.keys(GAMEPLAY_FIELDS), 'gameplay', errors);
  for (const [key, spec] of Object.entries(GAMEPLAY_FIELDS)) {
    value.gameplay[key] = readNumber(gameplay[key], `gameplay.${key}`, spec, errors);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}
