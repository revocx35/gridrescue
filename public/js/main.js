// Page bootstrap: applies the admin-set layout, wires input and runs the game loop.
import { Joystick } from './joystick.js';
import { fetchBoard, postScore, renderBoard, startRun } from './leaderboard.js';
import { Renderer, drawSpriteInBox, loadSprites } from './render.js';
import { MAPS, MAX_SCORE_NAME_LENGTH, NAMED_ROLES, mapConfig } from './schema.js';
import { applyUpgrade, availableUpgrades, createGame, destroyMissileAt, step } from './sim.js';

const FIXED_STEP = 1 / 60;
const NAME_KEY = 'gridrescue-name';
// How far from a missile a press still counts, in CSS pixels. Fingers are less exact than a cursor.
const MISSILE_REACH = { touch: 44, mouse: 28 };
const $ = (id) => document.getElementById(id);
const SECTION_IDS = { title: 'section-title', game: 'section-game', joystick: 'section-joystick' };

const layoutQuery = matchMedia('(pointer: coarse), (max-width: 760px)');
const isMobile = () => layoutQuery.matches;

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

function buildRoster(config, sprites) {
  const roster = $('roster');
  roster.replaceChildren();
  for (const role of NAMED_ROLES) {
    if (config.characters[role].enabled === false) continue;
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

class Game {
  constructor(fullConfig, mapId, sprites, loadMapSprites) {
    this.fullConfig = fullConfig;
    this.loadMapSprites = loadMapSprites;
    this.useMap(mapId, sprites, true);
    this.renderer = new Renderer($('game'), this.config, sprites);
    this.keyboard = new Keyboard();
    this.moveStick = new Joystick($('joystick-move'), $('knob-move'));
    this.aimStick = new Joystick($('joystick-aim'), $('knob-aim'));
    this.mouseAim = new MouseAim($('game'));
    this.mode = 'menu';
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.state = createGame(this.config, { view: this.renderer.view });
    this.toastTimer = 0;
    this.hudCache = {};

    this.renderer.resize();
    new ResizeObserver(() => this.renderer.resize()).observe($('section-game'));

    $('overlay-action').addEventListener('click', () => this.onOverlayAction());
    $('game').addEventListener('pointerdown', (e) => this.onCanvasPress(e));
    $('pause-btn').addEventListener('click', () => this.pause());
    $('score-form').addEventListener('submit', (e) => this.onScoreSubmit(e));
    $('score-name').maxLength = MAX_SCORE_NAME_LENGTH;
    $('board-toggle').addEventListener('click', () => this.toggleBoard());
    addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    this.showMenu();
    requestAnimationFrame((t) => this.frame(t));
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

  useMap(mapId, sprites, firstTime = false) {
    this.mapId = mapId;
    this.sprites = sprites;
    this.config = mapConfig(this.fullConfig, mapId);
    this.names = Object.fromEntries(NAMED_ROLES.map((role) => [role, this.config.characters[role].name]));
    buildRoster(this.config, sprites);
    if (firstTime) return;
    this.renderer.setMap(this.config, sprites);
    this.renderer.camera = null;
    this.state = createGame(this.config, { view: this.renderer.view });
  }

  buildMapPicker() {
    $('map-picker').replaceChildren(...MAPS.map((id) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-choice';
      button.textContent = this.fullConfig.maps[id].name;
      button.setAttribute('aria-pressed', String(id === this.mapId));
      button.addEventListener('click', () => this.selectMap(id));
      return button;
    }));
  }

  async selectMap(id) {
    if (id === this.mapId) return;
    this.pendingMap = id;
    const sprites = await this.loadMapSprites(id);
    // A slower earlier choice, or a game started meanwhile, must not swap the map underneath.
    if (this.pendingMap !== id || (this.mode !== 'menu' && this.mode !== 'ended')) return;
    this.useMap(id, sprites);
    this.mode = 'menu';
    this.showMenu();
  }

  onKey(e) {
    if (this.mode === 'levelup') {
      const choice = /^Digit([1-6])$/.exec(e.code);
      if (choice) $('upgrades').children[Number(choice[1]) - 1]?.click();
      return; // Enter and Space act on the focused upgrade; nothing else may restart the game
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.mode === 'playing') this.pause();
      else if (this.mode === 'paused') this.resume();
    } else if ((e.code === 'Enter' || e.code === 'Space') && this.mode !== 'playing') {
      if (e.target.closest?.('.map-choice, #score-form, #board-toggle')) return; // that key belongs to the control
      e.preventDefault();
      this.onOverlayAction();
    }
  }

  onOverlayAction() {
    if (this.mode === 'paused') this.resume();
    else this.start();
  }

  overlay({ heading, text, action, roster = false, upgrades = false, picker = false, score = false, boardButton = false }) {
    $('overlay-heading').textContent = heading;
    $('overlay-text').textContent = text;
    $('overlay-action').textContent = action ?? '';
    $('overlay-action').hidden = upgrades;
    $('upgrades').hidden = !upgrades;
    $('roster').hidden = !roster;
    $('map-picker').hidden = !picker;
    $('score-form').hidden = !score;
    $('board').hidden = true;
    $('board-toggle').hidden = !boardButton;
    $('board-toggle').textContent = 'Leaderboard';
    if (picker) this.buildMapPicker();
    $('controls-hint').hidden = !roster;
    $('overlay').hidden = false;
    // Not the name field: a movement key still held at the moment of victory would type into it.
    const first = upgrades ? $('upgrades').firstElementChild : score ? $('score-submit') : $('overlay-action');
    first.focus({ preventScroll: true, focusVisible: false });
  }

  upgradeLabel(id) {
    const { upgradeDamage, upgradeHealth, upgradeFireRate } = this.config.gameplay;
    return {
      pump: 'Change gun to pump',
      damage: `Add ${upgradeDamage}% damage`,
      fireRate: `Fire ${upgradeFireRate}% faster`,
      health: `Add ${upgradeHealth} health`,
      companion: `Add 1 more ${this.names.companion}`,
      pierce: 'Bullets pass through +1 enemy',
    }[id];
  }

  showUpgrades() {
    this.mode = 'levelup';
    this.mouseAim.reset();
    this.updateHud();
    $('upgrades').replaceChildren(...availableUpgrades(this.state).map((id, index) => {
      const key = document.createElement('span');
      key.className = 'upgrade-key';
      key.textContent = String(index + 1);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'upgrade';
      button.append(key, this.upgradeLabel(id));
      button.addEventListener('click', () => this.chooseUpgrade(id));
      return button;
    }));
    this.overlay({ heading: 'Level up', text: 'Choose one upgrade.', upgrades: true });
  }

  chooseUpgrade(id) {
    if (!applyUpgrade(this.state, id)) return;
    this.mode = 'playing';
    this.accumulator = 0;
    $('overlay').hidden = true;
    document.activeElement?.blur?.();
    for (const event of this.state.events.splice(0)) this.handleEvent(event);
  }

  showMenu() {
    const { site } = this.config;
    const { hostage, boss } = this.names;
    const ending = this.config.characters.boss.enabled ? `Defeat ${boss} to set them free.` : 'Reach them to set them free.';
    $('controls-hint').textContent = 'Move with WASD or the arrow keys. Attacks fire on their own; hold the mouse button to aim.';
    this.overlay({
      heading: `Rescue ${hostage}`,
      text: `Keep moving and destroy what chases you. Each kill lights up the way to ${hostage}. ${ending}`,
      action: site.startLabel,
      roster: true,
      picker: true,
      boardButton: true,
    });
  }

  start() {
    this.pendingMap = null;
    this.finishedRun = null;
    this.runToken = startRun(this.mapId);
    this.renderer.camera = null;
    this.renderer.particles.length = 0;
    this.renderer.rings.length = 0;
    this.state = createGame(this.config, { view: this.renderer.view });
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
    $('score-label').textContent = won ? 'Your name for the leaderboard' : 'Your name for the kill leaderboard';
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
    this.buildMapPicker();
    $('map-picker').hidden = false;
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
    const mapId = this.mapId;
    try {
      const data = await fetchBoard();
      if (mapId === this.mapId) renderBoard(host, data.maps[mapId], highlightId);
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

  toast(message, seconds = 2.4) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    this.toastTimer = seconds;
  }

  handleEvent(event) {
    this.renderer.handleEvent(event);
    const { companion, hostage, boss } = this.names;
    switch (event.type) {
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
      case 'levelUp':
        this.showUpgrades();
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
    return { x: keys.x + stick.x, y: keys.y + stick.y, aimX: aim.x, aimY: aim.y };
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
    const team = s.companions;
    $('companion-vital').hidden = !team.length;
    if (team.length) {
      this.setText('companion-name', team.length > 1 ? `${this.names.companion} ×${team.length}` : this.names.companion);
      this.setBar('companion-bar', team.reduce((sum, m) => sum + m.hp, 0) / team.reduce((sum, m) => sum + m.maxHp, 0));
    }
    const showBoss = s.boss.alive && s.boss.mode !== 'idle';
    $('boss-vital').hidden = !showBoss;
    if (showBoss) this.setBar('boss-bar', s.boss.hp / s.boss.maxHp);
  }

  frame(time) {
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
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
    this.renderer.draw(this.state, this.mode === 'paused' || this.mode === 'levelup' ? 0 : dt);
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
  new Game(config, MAPS[0], await loadMapSprites(MAPS[0]), loadMapSprites);
}

main();
