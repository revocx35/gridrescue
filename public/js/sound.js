// Plays the sounds an admin uploaded. There are no built-in sounds, so an empty slot simply stays silent.
// Uses Web Audio with fetch, so the page's CSP needs no media source.

const NEAR = 620; // world units within which an idle sound is heard
const SHOT_HEARING = 1300;
const MIN_SHOT_VOLUME = 0.15;
const MIN_GAP = 0.05; // seconds between two plays of one sound, so a pump volley is not a wall of noise
const MAX_VOICES = 16;
const THEME_VOLUME = 0.7;
const FADE = 0.08;
const BOSS_VIEW_MARGIN = 260;
const THEME_KEY = 'boss:theme';

export class SoundBoard {
  constructor() {
    this.context = null;
    this.urls = {};
    this.buffers = {}; // role -> slot -> AudioBuffer
    this.decoded = new Map(); // url -> Promise<AudioBuffer | null>
    this.loops = new Map(); // "role:slot" -> { source, gain }
    this.lastPlayed = new Map();
    this.voices = 0;
    // Browsers only allow audio to start from a user gesture.
    for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => this.unlock(), { capture: true });
  }

  unlock() {
    if (!this.context) {
      const Context = window.AudioContext ?? window.webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      this.#load();
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }

  /** characters is one map's public config: each role may have soundUrls. */
  setMap(characters) {
    this.#stopLoops();
    this.urls = Object.fromEntries(Object.entries(characters).map(([role, ch]) => [role, ch.soundUrls ?? {}]));
    this.buffers = {};
    if (this.context) this.#load();
  }

  #decode(url) {
    if (!this.decoded.has(url)) {
      this.decoded.set(url, fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject()))
        .then((bytes) => this.context.decodeAudioData(bytes))
        .catch(() => null));
    }
    return this.decoded.get(url);
  }

  #load() {
    const { urls } = this;
    for (const [role, slots] of Object.entries(urls)) {
      for (const [slot, url] of Object.entries(slots)) {
        this.#decode(url).then((buffer) => {
          if (buffer && urls === this.urls) (this.buffers[role] ??= {})[slot] = buffer; // a newer map may have been chosen
        });
      }
    }
  }

  /** A one-shot. Quiet with distance when a position is given. */
  play(role, slot, position = null, listener = null) {
    const buffer = this.buffers[role]?.[slot];
    if (!buffer || this.voices >= MAX_VOICES) return;
    const now = this.context.currentTime;
    const key = `${role}:${slot}`;
    if (now - (this.lastPlayed.get(key) ?? -1) < MIN_GAP) return;
    this.lastPlayed.set(key, now);
    const distance = position && listener ? Math.hypot(position.x - listener.x, position.y - listener.y) : 0;
    const gain = this.context.createGain();
    gain.gain.value = Math.max(MIN_SHOT_VOLUME, 1 - distance / SHOT_HEARING);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain).connect(this.context.destination);
    this.voices += 1;
    source.onended = () => { this.voices -= 1; };
    source.start();
  }

  #wantedLoops(state, renderer) {
    const wanted = new Map();
    const hear = (role, actor) => {
      if (!this.buffers[role]?.idle) return;
      const d = Math.hypot(actor.x - state.player.x, actor.y - state.player.y);
      if (d >= NEAR) return;
      const key = `${role}:idle`;
      wanted.set(key, Math.max(wanted.get(key) ?? 0, 1 - d / NEAR));
    };
    for (const e of state.enemies) hear(e.kind, e);
    for (const m of state.companions) if (!m.down) hear(m.role, m);
    if (state.hostage) hear('hostage', state.hostage);
    const bossSeen = (state.boss.alive && renderer.inView(state.boss, BOSS_VIEW_MARGIN))
      || state.enemies.some((e) => e.kind === 'boss' && renderer.inView(e, BOSS_VIEW_MARGIN));
    if (bossSeen && this.buffers.boss?.theme) wanted.set(THEME_KEY, THEME_VOLUME);
    return wanted;
  }

  /** Call once per frame with the game's mode. The upgrade shop keeps the theme going; any other stop silences every loop. */
  update(state, renderer, mode) {
    if (!this.context) return;
    if (mode !== 'playing' && mode !== 'shop') {
      this.#stopLoops();
      return;
    }
    const wanted = this.#wantedLoops(state, renderer);
    if (mode === 'shop') for (const key of wanted.keys()) if (key !== THEME_KEY) wanted.delete(key);
    for (const key of this.loops.keys()) if (!wanted.has(key)) this.#stopLoop(key);
    for (const [key, volume] of wanted) this.#setLoop(key, volume);
  }

  #setLoop(key, volume) {
    const now = this.context.currentTime;
    let loop = this.loops.get(key);
    if (!loop) {
      const [role, slot] = key.split(':');
      const gain = this.context.createGain();
      gain.gain.value = 0;
      const source = this.context.createBufferSource();
      source.buffer = this.buffers[role][slot];
      source.loop = true;
      source.connect(gain).connect(this.context.destination);
      source.start();
      loop = { source, gain };
      this.loops.set(key, loop);
    }
    loop.gain.gain.setTargetAtTime(volume, now, FADE);
  }

  #stopLoop(key) {
    const { source, gain } = this.loops.get(key);
    this.loops.delete(key);
    gain.gain.setTargetAtTime(0, this.context.currentTime, FADE);
    source.stop(this.context.currentTime + FADE * 4);
  }

  #stopLoops() {
    for (const key of [...this.loops.keys()]) this.#stopLoop(key);
  }
}
