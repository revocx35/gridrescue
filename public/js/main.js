// Page bootstrap: applies the admin-set layout, wires input and runs the game loop.
import { Joystick } from './joystick.js';
import { fetchBoard, postScore, renderBoard, startRun } from './leaderboard.js';
import { PATCH_NOTES } from './patch-notes.js';
import { Renderer, drawSpriteInBox, loadSprites } from './render.js';
import { GAME_MODES, MAPS, MAX_SCORE_NAME_LENGTH, NAMED_ROLES, mapConfig } from './schema.js';
import { SoundBoard } from './sound.js';
import { SHOP_ITEMS, applyUpgrade, createGame, destroyMissileAt, frameSeconds, setAutoBuy, shopSections, spendAutoBuy, step } from './sim.js';

const FIXED_STEP = 1 / 60;
const NAME_KEY = 'gridrescue-name';
const MAP_KEY = 'gridrescue-map';
const MODE_KEY = 'gridrescue-mode';
const AIM_BOSS_KEY = 'gridrescue-aim-boss';
const AIM_BOSS_CHOICES = ['off', 'on'];
const AUTO_BUY_KEY = 'gridrescue-auto-buy';
// How far from a missile a press still counts, in CSS pixels. Fingers are less exact than a cursor.
const MISSILE_REACH = { touch: 44, mouse: 28 };
const $ = (id) => document.getElementById(id);
const MODE_LABELS = { rescue: 'Rescue', endless: 'Endless' };
const SHOP_LABELS = { weapons: 'Weapons', defense: 'Defense', companions: 'Companions' };
const SHOP_NOTES = { owned: 'Owned', full: 'Team full', needsLaser: 'Needs the laser', needsCompanion: 'Needs a companion' };
const SHOP_PREVIOUS_TAB = ['ArrowLeft', 'KeyA'];
const SHOP_NEXT_TAB = ['ArrowRight', 'KeyD'];
const SECTION_IDS = { title: 'section-title', game: 'section-game', joystick: 'section-joystick' };

const layoutQuery = matchMedia('(pointer: coarse), (max-width: 760px)');
const isMobile = () => layoutQuery.matches;

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* private browsing */ }
}

/** The stored choice if it is still a valid one, otherwise the first option. */
function recall(key, options) {
  try {
    const stored = localStorage.getItem(key);
    if (options.includes(stored)) return stored;
  } catch { /* private browsing */ }
  return options[0];
}

/** A stored list of choices, keeping only the ones that are still valid. */
function recallList(key, options) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(stored)) return [...new Set(stored.filter((item) => options.includes(item)))];
  } catch { /* private browsing or a damaged value */ }
  return [];
}

function applyOrder(site) {
  const order = isMobile() ? site.mobileOrder : site.desktopOrder;
  for (const [key, id] of Object.entries(SECTION_IDS)) $(id).style.order = String(Math.max(order.indexOf(key), 0));
}

function applySite(site) {
  const root = document.documentElement.style;
  const c = site.colors;
  root.setProperty('--bg', c.background);
  root.setProperty('--text', c.text);
  root.setProperty('--accent', c.accent);
  root.setProperty('--accent2', c.accent2);
  root.setProperty('--title-desktop', `${site.titleSizeDesktop}px`);
  root.setProperty('--title-mobile', `${site.titleSizeMobile}px`);
  root.setProperty('--title-align', site.titleAlign);
  root.setProperty('--joy-size', `${site.joystickSize}px`);
  document.body.dataset.moveSide = site.joystickSide;
  document.title = site.title;
  document.querySelector('meta[name="theme-color"]').content = c.background;
  $('site-title').textContent = site.title;
  $('site-tagline').textContent = site.tagline;
  $('site-tagline').hidden = !site.tagline;
}

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function buildRoster(config, sprites, gameMode) {
  const roster = $('roster');
  roster.replaceChildren();
  for (const role of NAMED_ROLES) {
    const ch = config.characters[role]; // not every role exists on every map
    if (!ch || ch.enabled === false || (role === 'hostage' && gameMode === 'endless')) continue;
    const item = document.createElement('div');
    item.className = 'roster-item';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    drawSpriteInBox(canvas.getContext('2d'), sprites[role], 0, 0, 96);
    const name = document.createElement('span');
    name.className = 'roster-name';
    name.textContent = config.characters[role].name;
    name.title = config.characters[role].name;
    item.append(canvas, name);
    roster.append(item);
  }
}

class Keyboard {
  constructor() {
    this.down = new Set();
    const map = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
    };
    addEventListener('keydown', (e) => {
      const dir = map[e.code];
      if (!dir || e.target.closest?.('input')) return; // typing a name must not be swallowed as movement
      this.down.add(dir);
      e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(map[e.code]));
    addEventListener('blur', () => this.down.clear());
  }

  get vector() {
    return {
      x: (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0),
      y: (this.down.has('down') ? 1 : 0) - (this.down.has('up') ? 1 : 0),
    };
  }
}

/** Holding the left mouse button aims at the cursor. Touches on the canvas are ignored. */
class MouseAim {
  constructor(canvas) {
    this.canvas = canvas;
    this.pointer = null;
    this.position = { x: 0, y: 0 };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      this.pointer = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      this.#track(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointer) this.#track(e);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => {
        if (e.pointerId === this.pointer) this.pointer = null;
      });
    }
    addEventListener('blur', () => this.reset());
  }

  #track(e) {
    const box = this.canvas.getBoundingClientRect();
    this.position = { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  /** Direction from a canvas position to the cursor, or zero when the button is up. */
  vectorFrom(origin) {
    if (this.pointer === null) return { x: 0, y: 0 };
    return { x: this.position.x - origin.x, y: this.position.y - origin.y };
  }

  reset() {
    if (this.pointer !== null && this.canvas.hasPointerCapture(this.pointer)) this.canvas.releasePointerCapture(this.pointer);
    this.pointer = null;
  }
}

function patchNotesEntry({ version, date, changes }) {
  const entry = document.createElement('article');
  entry.className = 'notes-entry';
  const heading = document.createElement('h3');
  heading.textContent = `Version ${version}`;
  const when = document.createElement('time');
  when.className = 'micro';
  when.dateTime = date;
  when.textContent = date;
  const list = document.createElement('ul');
  for (const change of changes) {
    const item = document.createElement('li');
    item.textContent = change;
    list.append(item);
  }
  entry.append(heading, when, list);
  return entry;
}

class Game {
  constructor(fullConfig, mapId, sprites, loadMapSprites) {
    this.fullConfig = fullConfig;
    this.loadMapSprites = loadMapSprites;
    this.gameMode = recall(MODE_KEY, GAME_MODES);
    this.aimBoss = recall(AIM_BOSS_KEY, AIM_BOSS_CHOICES) === 'on';
    this.autoBuy = recallList(AUTO_BUY_KEY, SHOP_ITEMS); // carried from run to run
    this.sounds = new SoundBoard();
    this.useMap(mapId, sprites, true);
    this.renderer = new Renderer($('game'), this.config, sprites);
    this.keyboard = new Keyboard();
    this.moveStick = new Joystick($('joystick-move'), $('knob-move'));
    this.aimStick = new Joystick($('joystick-aim'), $('knob-aim'));
    this.mouseAim = new MouseAim($('game'));
    this.mode = 'menu';
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.state = this.newGame();
    this.toastTimer = 0;
    this.hudCache = {};

    this.renderer.resize();
    new ResizeObserver(() => this.renderer.resize()).observe($('section-game'));

    $('overlay-action').addEventListener('click', () => this.onOverlayAction());
    $('game').addEventListener('pointerdown', (e) => this.onCanvasPress(e));
    $('pause-btn').addEventListener('click', () => this.pause());
    $('shop-btn').addEventListener('click', () => this.openShop());
    $('aim-boss-btn').setAttribute('aria-pressed', String(this.aimBoss));
    $('aim-boss-btn').addEventListener('click', () => this.toggleAimBoss());
    $('score-form').addEventListener('submit', (e) => this.onScoreSubmit(e));
    $('score-name').maxLength = MAX_SCORE_NAME_LENGTH;
    $('board-toggle').addEventListener('click', () => this.toggleBoard());
    $('notes-toggle').addEventListener('click', () => this.toggleNotes());
    addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    this.showMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  newGame() {
    const s = createGame(this.config, { view: this.renderer.view, mode: this.gameMode });
    for (const id of this.autoBuy) setAutoBuy(s, id, true);
    return s;
  }

  onCanvasPress(event) {
    if (this.mode !== 'playing' || event.button !== 0) return;
    const box = $('game').getBoundingClientRect();
    const { x, y } = this.renderer.toWorld(event.clientX - box.left, event.clientY - box.top);
    const reach = (MISSILE_REACH[event.pointerType] ?? MISSILE_REACH.mouse) / this.renderer.scale;
    if (destroyMissileAt(this.state, x, y, reach)) {
      for (const gameEvent of this.state.events.splice(0)) this.handleEvent(gameEvent);
    }
  }

  toggleAimBoss() {
    this.aimBoss = !this.aimBoss;
    remember(AIM_BOSS_KEY, this.aimBoss ? 'on' : 'off');
    $('aim-boss-btn').setAttribute('aria-pressed', String(this.aimBoss));
    $('aim-boss-btn').blur(); // or Space during play would keep switching it
  }

  useMap(mapId, sprites, firstTime = false) {
    this.mapId = mapId;
    this.sprites = sprites;
    this.config = mapConfig(this.fullConfig, mapId);
    this.names = Object.fromEntries(NAMED_ROLES.filter((role) => this.config.characters[role]).map((role) => [role, this.config.characters[role].name]));
    buildRoster(this.config, sprites, this.gameMode);
    this.sounds.setMap(this.config.characters);
    if (firstTime) return;
    this.renderer.setMap(this.config, sprites);
    this.renderer.camera = null;
    this.state = this.newGame();
  }

  buildPickers() {
    const choice = (label, pressed, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-choice';
      button.textContent = label;
      button.setAttribute('aria-pressed', String(pressed));
      button.addEventListener('click', onClick);
      return button;
    };
    $('map-picker').replaceChildren(...MAPS.map((id) => choice(this.fullConfig.maps[id].name, id === this.mapId, () => this.selectMap(id))));
    $('mode-picker').replaceChildren(...GAME_MODES.map((id) => choice(MODE_LABELS[id], id === this.gameMode, () => this.selectMode(id))));
  }

  selectMode(id) {
    if (id === this.gameMode || (this.mode !== 'menu' && this.mode !== 'ended')) return;
    this.gameMode = id;
    remember(MODE_KEY, id);
    buildRoster(this.config, this.sprites, id);
    this.state = this.newGame();
    this.mode = 'menu';
    this.showMenu();
  }

  async selectMap(id) {
    if (id === this.mapId) return;
    this.pendingMap = id;
    const sprites = await this.loadMapSprites(id);
    // A slower earlier choice, or a game started meanwhile, must not swap the map underneath.
    if (this.pendingMap !== id || (this.mode !== 'menu' && this.mode !== 'ended')) return;
    this.useMap(id, sprites);
    remember(MAP_KEY, id);
    this.mode = 'menu';
    this.showMenu();
  }

  onKey(e) {
    if (this.mode === 'shop') {
      this.onShopKey(e);
      return; // Enter and Space act on the focused button; nothing else may restart the game
    }
    if (e.code === 'KeyB' && this.mode === 'playing' && !e.repeat) {
      this.openShop();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.mode === 'playing') this.pause();
      else if (this.mode === 'paused') this.resume();
    } else if ((e.code === 'Enter' || e.code === 'Space') && this.mode !== 'playing') {
      if (e.target.closest?.('.map-choice, #score-form, #board-toggle, #notes-toggle, #notes')) return; // that key belongs to the control
      e.preventDefault();
      this.onOverlayAction();
    }
  }

  onShopKey(e) {
    if (e.repeat) return; // holding a number must not spend every point at once
    const choice = /^Digit([1-9])$/.exec(e.code);
    const row = choice && $('upgrades').children[Number(choice[1]) - 1];
    if (row) row.querySelector(e.shiftKey ? '.upgrade-auto' : '.upgrade')?.click();
    else if (e.code === 'KeyB' || e.code === 'Escape') this.closeShop();
    else if (SHOP_PREVIOUS_TAB.includes(e.code)) this.moveShopTab(-1);
    else if (SHOP_NEXT_TAB.includes(e.code)) this.moveShopTab(1);
  }

  onOverlayAction() {
    if (this.mode === 'shop') this.closeShop();
    else if (this.mode === 'paused') this.resume();
    else this.start();
  }

  overlay({ heading, text, action, roster = false, shop = false, picker = false, score = false, boardButton = false, hint = '' }) {
    $('overlay-heading').textContent = heading;
    $('overlay-text').textContent = text;
    $('overlay-action').textContent = action ?? '';
    $('shop-tabs').hidden = !shop;
    $('upgrades').hidden = !shop;
    $('roster').hidden = !roster;
    $('map-picker').hidden = !picker;
    $('mode-picker').hidden = !picker;
    $('score-form').hidden = !score;
    $('board').hidden = true;
    $('board-toggle').hidden = !boardButton;
    $('board-toggle').textContent = 'Leaderboard';
    $('notes-toggle').hidden = !boardButton;
    this.setNotesOpen(false);
    if (picker) this.buildPickers();
    $('controls-hint').textContent = hint;
    $('controls-hint').hidden = !hint;
    $('overlay').hidden = false;
    // Not the name field: a movement key still held at the moment of victory would type into it.
    const buyable = shop ? $('upgrades').querySelector('.upgrade:not(:disabled)') : null;
    const first = buyable ?? (score ? $('score-submit') : $('overlay-action'));
    first.focus({ preventScroll: true, focusVisible: false });
  }

  shopLabel(id) {
    const g = this.config.gameplay;
    return {
      pump: 'Get pump gun',
      damage: `Add ${g.upgradeDamage}% damage`,
      fireRate: `Fire ${g.upgradeFireRate}% faster`,
      pierce: 'Bullets pass through +1 enemy',
      health: `Add ${g.upgradeHealth} health`,
      regen: `Replenish +${g.upgradeRegen} health per second`,
      laser: 'Get personal laser: shoots down incoming bullets',
      laserRate: `Laser recharges ${g.upgradeLaserRate}% faster`,
      laserRange: `Laser reaches ${g.upgradeLaserRange} further`,
      laserBeams: 'Laser hits +1 bullet at a time',
      companion: `Get ${this.names.companion}`,
      companion2: `Get ${this.names.companion2}`,
      companionDamage: `Companions deal ${g.upgradeCompanionDamage}% more damage`,
      companionFireRate: `Companions fire ${g.upgradeCompanionFireRate}% faster`,
      companionHealth: `Companions get ${g.upgradeCompanionHealth}% more health`,
    }[id];
  }

  openShop() {
    if (this.mode !== 'playing') return;
    this.mode = 'shop';
    this.mouseAim.reset();
    this.updateHud();
    this.showShop();
  }

  closeShop() {
    if (this.mode !== 'shop') return;
    this.resume();
  }

  moveShopTab(step) {
    const ids = shopSections(this.state).map((section) => section.id);
    const index = ids.indexOf(this.shopTab);
    this.shopTab = ids[(index + step + ids.length) % ids.length];
    this.showShop();
  }

  shopTabButton({ id }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-choice';
    button.textContent = SHOP_LABELS[id];
    button.setAttribute('aria-pressed', String(id === this.shopTab));
    button.addEventListener('click', () => {
      this.shopTab = id;
      this.showShop();
    });
    return button;
  }

  shopItemButton(item, index, points) {
    const key = document.createElement('span');
    key.className = 'upgrade-key';
    key.textContent = String(index + 1);
    const label = document.createElement('span');
    label.className = 'upgrade-label';
    label.textContent = this.shopLabel(item.id);
    const note = document.createElement('span');
    note.className = 'upgrade-note';
    note.textContent = SHOP_NOTES[item.state] ?? (item.bought ? `×${item.bought}` : '');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'upgrade';
    button.disabled = item.state !== 'ready' || points < 1;
    button.append(key, label, note);
    button.addEventListener('click', () => this.buyUpgrade(item.id));
    const auto = document.createElement('button');
    auto.type = 'button';
    auto.className = 'upgrade-auto';
    auto.textContent = 'Auto';
    auto.dataset.item = item.id;
    auto.title = 'Buy this on its own whenever you have a point';
    auto.setAttribute('aria-label', `Auto-buy: ${this.shopLabel(item.id)}`);
    auto.setAttribute('aria-pressed', String(this.state.autoBuy.includes(item.id)));
    auto.disabled = item.state === 'owned'; // a one-time item already bought has nothing left to buy
    auto.addEventListener('click', () => this.toggleAutoBuy(item.id));
    const row = document.createElement('div');
    row.className = 'upgrade-row';
    row.append(button, auto);
    return row;
  }

  showShop() {
    const points = this.state.upgradePoints;
    const sections = shopSections(this.state);
    const section = sections.find(({ id }) => id === this.shopTab) ?? sections[0];
    this.shopTab = section.id;
    $('shop-tabs').replaceChildren(...sections.map((entry) => this.shopTabButton(entry)));
    $('upgrades').replaceChildren(...section.items.map((item, index) => this.shopItemButton(item, index, points)));
    this.overlay({
      heading: 'Upgrade shop',
      text: points ? `${points} upgrade${points === 1 ? '' : 's'} to spend.` : `No upgrades to spend yet. Every ${this.config.gameplay.xpToUpgrade} XP earns one.`,
      action: 'Back to game',
      shop: true,
      hint: 'Number keys buy, Shift + number sets Auto, A and D change section, B goes back. Auto items are bought as soon as you have a point.',
    });
  }

  buyUpgrade(id) {
    if (!applyUpgrade(this.state, id)) return;
    for (const event of this.state.events.splice(0)) this.handleEvent(event);
    this.updateHud();
    if (this.state.upgradePoints) this.showShop();
    else this.closeShop();
  }

  toggleAutoBuy(id) {
    if (this.mode !== 'shop') return;
    setAutoBuy(this.state, id, !this.state.autoBuy.includes(id));
    this.autoBuy = [...this.state.autoBuy];
    remember(AUTO_BUY_KEY, JSON.stringify(this.autoBuy));
    spendAutoBuy(this.state); // points already banked go to it straight away
    for (const event of this.state.events.splice(0)) this.handleEvent(event);
    this.updateHud();
    this.showShop(); // stays open: the player may be setting several
    $('upgrades').querySelector(`.upgrade-auto[data-item="${id}"]`)?.focus({ preventScroll: true, focusVisible: false });
  }

  showMenu() {
    const { site } = this.config;
    const { hostage, boss } = this.names;
    const ending = this.config.characters.boss.enabled ? `Defeat ${boss} to set them free.` : 'Reach them to set them free.';
    const endless = this.gameMode === 'endless';
    const bossWarning = this.config.characters.boss.enabled ? ` Very rarely, ${boss} comes hunting too.` : '';
    this.overlay({
      heading: endless ? 'Endless run' : `Rescue ${hostage}`,
      text: endless
        ? `No one to rescue, nowhere to reach. Survive for as long as you can.${bossWarning}`
        : `Keep moving and destroy what chases you. Each kill lights up the way to ${hostage}. ${ending}`,
      action: site.startLabel,
      roster: true,
      picker: true,
      boardButton: true,
      hint: 'Move with WASD or the arrow keys. Attacks fire on their own; hold the mouse button to aim. Aim boss makes shots go for a boss first. Press B for the upgrade shop.',
    });
  }

  start() {
    this.pendingMap = null;
    this.finishedRun = null;
    this.runToken = startRun(this.mapId, this.gameMode);
    this.sounds.unlock();
    this.renderer.camera = null;
    this.renderer.particles.length = 0;
    this.renderer.rings.length = 0;
    this.renderer.beams.length = 0;
    this.state = this.newGame();
    this.shopTab = null;
    this.hintExplained = false;
    this.mode = 'playing';
    this.accumulator = 0;
    this.moveStick.reset();
    this.aimStick.reset();
    this.mouseAim.reset();
    $('overlay').hidden = true;
    $('hud').hidden = false;
    $('player-name').textContent = this.names.player;
    $('companion-name').textContent = this.names.companion;
    $('boss-name').textContent = this.names.boss;
    document.activeElement?.blur?.();
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.mouseAim.reset();
    this.overlay({ heading: 'Paused', text: `Time ${formatTime(this.state.time)}, ${this.state.kills} destroyed.`, action: 'Resume' });
  }

  resume() {
    this.mode = 'playing';
    this.lastFrame = performance.now();
    this.accumulator = 0;
    $('overlay').hidden = true;
    document.activeElement?.blur?.();
  }

  finish(won) {
    this.mode = 'ended';
    const { site } = this.config;
    $('hud').hidden = true;
    $('toast').hidden = true;
    const { time, kills } = this.state;
    const canSave = won || kills > 0; // a run with no rescue and no kills has nothing to rank
    this.finishedRun = canSave ? { token: this.runToken, time, kills, won } : null;
    if (canSave) this.prepareScoreForm(won);
    this.overlay({
      heading: won ? `${this.names.hostage} rescued` : 'Game over',
      text: `${won ? site.winText : site.loseText} Time ${formatTime(this.state.time)}, ${this.state.kills} destroyed.`,
      action: 'Play again',
      picker: !canSave, // choosing a map replaces this screen, which would lose the unsaved score
      score: canSave,
      boardButton: true,
    });
  }

  prepareScoreForm(won) {
    const label = this.gameMode === 'endless' ? 'Your name for the Endless leaderboard'
      : won ? 'Your name for the leaderboard' : 'Your name for the kill leaderboard';
    $('score-label').textContent = label;
    let remembered = '';
    try {
      remembered = localStorage.getItem(NAME_KEY) ?? '';
    } catch { /* private browsing */ }
    $('score-name').value = remembered;
    $('score-status').textContent = '';
    $('score-submit').disabled = false;
  }

  async onScoreSubmit(event) {
    event.preventDefault();
    const run = this.finishedRun;
    if (!run || $('score-submit').disabled) return;
    const name = $('score-name').value.trim();
    if (!name) {
      $('score-status').textContent = 'Enter a name first.';
      $('score-name').focus();
      return;
    }
    $('score-submit').disabled = true;
    $('score-status').textContent = 'Saving…';
    const token = await run.token;
    const result = token
      ? await postScore({ token, name, time: Math.round(run.time * 100) / 100, kills: run.kills, won: run.won })
      : { ok: false, error: 'invalid_run' };
    if (run !== this.finishedRun) return; // the player already started another game
    if (!result.ok) {
      $('score-status').textContent = {
        invalid_name: 'That name cannot be used. Try another one.',
        invalid_run: 'This run could not be saved.',
        rate_limited: 'Too many scores in a short time. Wait a minute and try again.',
      }[result.error] ?? 'Could not reach the server. Try again.';
      $('score-submit').disabled = result.error === 'invalid_run';
      return;
    }
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch { /* private browsing */ }
    this.finishedRun = null;
    $('score-form').hidden = true;
    this.buildPickers();
    $('map-picker').hidden = false;
    $('mode-picker').hidden = false;
    $('board-toggle').hidden = true;
    await this.showBoard(result.entry.id);
    $('overlay-action').focus({ preventScroll: true, focusVisible: false });
  }

  async showBoard(highlightId) {
    const host = $('board');
    const message = document.createElement('p');
    message.className = 'board-message';
    message.textContent = 'Loading…';
    host.replaceChildren(message);
    host.hidden = false;
    const { mapId, gameMode } = this;
    try {
      const data = await fetchBoard();
      if (mapId === this.mapId && gameMode === this.gameMode) renderBoard(host, data.maps[mapId], highlightId, gameMode);
    } catch {
      message.textContent = 'Could not load the leaderboard.';
    }
  }

  toggleBoard() {
    const opening = $('board').hidden;
    $('board-toggle').textContent = opening ? 'Hide leaderboard' : 'Leaderboard';
    if (opening) this.showBoard();
    else $('board').hidden = true;
  }

  setNotesOpen(open) {
    if (open && !$('notes').hasChildNodes()) $('notes').replaceChildren(...PATCH_NOTES.map(patchNotesEntry));
    $('notes').hidden = !open;
    $('notes-toggle').textContent = open ? 'Hide patch notes' : 'Patch notes';
    $('notes-toggle').setAttribute('aria-expanded', String(open));
  }

  toggleNotes() {
    this.setNotesOpen($('notes').hidden);
    if (!$('notes').hidden) $('notes').scrollIntoView({ block: 'nearest' }); // on a phone it opens below the fold
  }

  toast(message, seconds = 2.4) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    this.toastTimer = seconds;
  }

  handleEvent(event) {
    this.renderer.handleEvent(event);
    const { hostage, boss } = this.names;
    const companion = this.names[event.role];
    switch (event.type) {
      case 'shot':
        this.sounds.play(event.role, 'shoot', event, this.state.player);
        break;
      case 'kamikaze':
        this.sounds.play(event.role, 'impact', event, this.state.player);
        break;
      case 'bossSpawn':
        this.toast(`${boss} has appeared`, 3.2);
        break;
      case 'rocketeer':
        this.toast(`${this.names.rocketeer} on the bus! Your guns can shoot its rockets down.`, 3.2);
        break;
      case 'hint':
        if (!this.hintExplained) this.toast(`The light shows the general way to ${hostage}`);
        this.hintExplained = true;
        break;
      case 'jet':
        this.toast(`${this.names.jet} incoming. ${isMobile() ? 'Tap' : 'Click'} its missiles to destroy them!`, 3.2);
        break;
      case 'difficulty':
        this.toast(`Difficulty level ${event.level}`);
        break;
      case 'enemy5':
        this.toast(`${this.names.enemy5} has appeared`);
        break;
      case 'companion':
        this.toast(event.revived ? `${companion} is back` : `${companion} joined the fight`);
        break;
      case 'companionDown':
        this.toast(`${companion} is down`);
        break;
      case 'bossWake':
        this.toast(`${boss} has seen you`);
        break;
      case 'bossRetreat':
        this.toast(`${boss} went back to guard ${hostage}`);
        break;
      case 'bossDead':
        this.toast(`${boss} is defeated. Reach ${hostage}!`, 4);
        break;
      case 'hostageLocked':
        this.toast(`Defeat ${boss} to free ${hostage}`);
        break;
      case 'autoBought':
        this.toast(event.ids.length === 1 ? `Auto-bought: ${this.shopLabel(event.ids[0])}` : `Auto-bought ${event.ids.length} upgrades`);
        break;
      case 'upgradeReady':
        this.toast(`Upgrade ready. ${isMobile() ? 'Tap Shop' : 'Press B'} to spend it.`);
        break;
      case 'win':
        this.finish(true);
        break;
      case 'lose':
        this.finish(false);
        break;
      default:
    }
  }

  input() {
    const keys = this.keyboard.vector;
    const stick = this.moveStick.vector;
    const { player } = this.state;
    const held = this.aimStick.vector;
    const aim = held.x || held.y ? held : this.mouseAim.vectorFrom(this.renderer.toScreen(player.x, player.y));
    return { x: keys.x + stick.x, y: keys.y + stick.y, aimX: aim.x, aimY: aim.y, aimBoss: this.aimBoss };
  }

  setBar(id, fraction) {
    const value = Math.round(Math.max(0, Math.min(1, fraction)) * 200) / 200;
    if (this.hudCache[id] === value) return;
    this.hudCache[id] = value;
    $(id).style.transform = `scaleX(${value})`;
  }

  setText(id, text) {
    if (this.hudCache[id] === text) return;
    this.hudCache[id] = text;
    $(id).textContent = text;
  }

  updateHud() {
    const s = this.state;
    this.setBar('player-bar', s.player.hp / s.player.maxHp);
    this.setText('stat-kills', String(s.kills));
    this.setText('stat-time', formatTime(s.time));
    const need = this.config.gameplay.xpToUpgrade;
    this.setBar('xp-bar', s.xp / need);
    this.setText('xp-text', `${s.xp} / ${need}`);
    this.setText('stat-level', String(s.level));
    const points = s.upgradePoints;
    this.setText('stat-points', String(points));
    this.setText('shop-count', String(points));
    $('points-label').hidden = !points;
    $('shop-count').hidden = !points;
    $('shop-btn').classList.toggle('has-points', points > 0);
    const team = s.companions;
    $('companion-vital').hidden = !team.length;
    if (team.length) {
      const kinds = new Set(team.map((m) => m.role));
      const name = kinds.size > 1 ? 'Team' : this.names[team[0].role];
      this.setText('companion-name', team.length > 1 ? `${name} ×${team.length}` : name);
      this.setBar('companion-bar', team.reduce((sum, m) => sum + m.hp, 0) / team.reduce((sum, m) => sum + m.maxHp, 0));
    }
    const showBoss = s.boss.alive && s.boss.mode !== 'idle';
    $('boss-vital').hidden = !showBoss;
    if (showBoss) this.setBar('boss-bar', s.boss.hp / s.boss.maxHp);
  }

  frame(time) {
    const dt = frameSeconds(time, this.lastFrame);
    this.lastFrame = time;
    if (this.mode === 'playing') {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_STEP && this.mode === 'playing') {
        step(this.state, FIXED_STEP, this.input());
        this.accumulator -= FIXED_STEP;
        for (const event of this.state.events.splice(0)) this.handleEvent(event);
      }
      if (this.mode === 'playing') this.updateHud();
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').hidden = true;
    }
    this.renderer.draw(this.state, this.mode === 'paused' || this.mode === 'shop' ? 0 : dt);
    this.sounds.update(this.state, this.renderer, this.mode);
    requestAnimationFrame((t) => this.frame(t));
  }
}

async function main() {
  let config;
  try {
    const response = await fetch('/api/config', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(String(response.status));
    config = await response.json();
  } catch {
    $('overlay-heading').textContent = 'Could not load the game';
    $('overlay-text').textContent = 'Check your connection, then try again.';
    $('overlay-action').textContent = 'Retry';
    $('overlay-action').addEventListener('click', () => location.reload());
    return;
  }

  const syncLayout = () => {
    document.body.dataset.layout = isMobile() ? 'mobile' : 'desktop';
    applyOrder(config.site);
  };
  applySite(config.site);
  syncLayout();
  layoutQuery.addEventListener('change', syncLayout);

  const loaded = new Map();
  const loadMapSprites = (id) => {
    if (!loaded.has(id)) loaded.set(id, loadSprites(id, config.maps[id].characters));
    return loaded.get(id);
  };
  const firstMap = recall(MAP_KEY, MAPS);
  new Game(config, firstMap, await loadMapSprites(firstMap), loadMapSprites);
}

main();
