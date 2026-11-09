// Game rules, with no DOM access: the browser renders this state and tests run it headlessly.
import { CHUNK_SIZE, createForest, createWasteland, forEachItemIn, hitsSolid, pushOutOfSolids } from './scenery.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SHOT_SPEED = 680;
const BOSS_BULLET_SPEED = 300;
const DESPAWN_DISTANCE = 2600;
const PLAYER_GRACE = 0.28;
const LEASH_FACTOR = 2.3;
const RANGED = {
  sniper: { range: 540, interval: 2.4, windup: 0.5, pellets: 1, spread: 0, speed: 640, ttl: 1.3, r: 6, retreat: true },
  pump: { range: 250, interval: 1.7, windup: 0.25, pellets: 5, spread: 0.17, speed: 430, ttl: 0.75, r: 7, retreat: false },
};
const ORB_MAGNET = 150;
const ORB_PICKUP = 26;
const ORB_SPEED = 560;
const MAX_COMPANIONS = 6;
const MISSILE_TTL = 8;
const MISSILE_TURN_RATE = 2.4; // radians per second: fast enough to chase, slow enough to sidestep
const JET_MAX_LIFE = 30;
const BALL_TELEGRAPH = 0.5;
const BALL_TTL = 5;
const NEAREST_HOSTAGE_FACTOR = 0.85;
const FASTEST_SPAWN_FACTOR = 0.42;
const RESCUE_GAP = 24;
const KILL_HEAL = { enemy1: 12, enemy2: 3, enemy5: 30, jet: 20, boss: 40, rocketeer: 10 };
const START_CLEARING = 260;
const BUS_SCAN_MARGIN = 240;
const ROCKET_PRIORITY = 0.6; // auto-aim counts a rocket as this much closer, so it is shot down in a crowd
// The widest strip of world any screen can show, used to bound how many buses a run can pass.
const WIDEST_VIEW = 3400;
const PLAYER_PUMP = { pellets: 5, spread: 0.15, ttl: 0.46, damageFactor: 0.55, intervalFactor: 1.7 };
export const CELL_SIZE = 80;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const radius = (size) => size * 0.42;

function actor(x, y, ch) {
  return {
    x, y, vx: 0, vy: 0,
    hp: ch.hp, maxHp: ch.hp,
    r: radius(ch.size),
    cool: 0, flash: 0, face: 1,
  };
}

/**
 * The most a real run on this map can do, for checking scores the browser reports. The time is
 * loosened by a tenth because sliding around obstacles can add a little ground speed.
 */
export function scoreLimits(cfg) {
  const { player, hostage } = cfg.characters;
  const walk = cfg.gameplay.hostageDistance * NEAREST_HOSTAGE_FACTOR - radius(player.size) - radius(hostage.size) - RESCUE_GAP;
  return {
    minTime: Math.max(0, walk / player.speed) * 0.9,
    minSpawnGap: 1 / (1 / (cfg.gameplay.spawnInterval * FASTEST_SPAWN_FACTOR) + busKillRate(cfg)),
  };
}

/** Rocketeers come on top of the spawn pacing: this bounds how many buses a player can run past per second. */
function busKillRate(cfg) {
  if (cfg.mapId !== 'wasteland' || !cfg.characters.rocketeer.enabled) return 0;
  return (cfg.characters.player.speed * WIDEST_VIEW * cfg.characters.rocketeer.spawnChance) / CHUNK_SIZE ** 2;
}

/** The arena and the start stay open so a fight is never decided by where an obstacle landed. */
function createWorld(cfg, rng, hostage, arena) {
  if (cfg.mapId !== 'forest' && cfg.mapId !== 'wasteland') return null;
  const clearings = [{ x: 0, y: 0, r: START_CLEARING }];
  if (hostage) clearings.push({ x: hostage.x, y: hostage.y, r: arena + 60 });
  const seed = Math.floor(rng() * 2 ** 31);
  return cfg.mapId === 'forest' ? createForest(seed, clearings) : createWasteland(seed, clearings, cfg.characters.rocketeer.spawnChance);
}

const BOSS_CONTACT_FACTOR = 1.6;
const bossTimers = () => ({ fanT: 1.2, ringT: 3.4, chargeT: 5, windup: 0, dash: 0, dashX: 0, dashY: 0 });

/** view is the half-size of the visible world, kept current by the renderer. mode is 'rescue' or 'endless'. */
export function createGame(cfg, { rng = Math.random, view = { halfW: 500, halfH: 350 }, mode = 'rescue' } = {}) {
  const c = cfg.characters;
  const endless = mode === 'endless';
  const angle = rng() * TAU;
  const distance = cfg.gameplay.hostageDistance * (NEAREST_HOSTAGE_FACTOR + rng() * 0.3);
  const hostage = endless ? null : { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, r: radius(c.hostage.size) };
  const arena = cfg.gameplay.arenaRadius;
  // In Endless the guardian never exists as such: a boss is only ever a regular entry in s.enemies.
  const boss = {
    ...actor(hostage?.x ?? 0, (hostage?.y ?? 0) - arena * 0.4, c.boss),
    kind: 'boss', size: c.boss.size, mode: 'idle', alive: !endless && c.boss.enabled,
    ...bossTimers(),
  };
  const world = createWorld(cfg, rng, hostage, arena);
  return {
    cfg, rng, view, world, mode,
    crewedBuses: new Set(),
    status: 'playing',
    time: 0, kills: 0, level: 1, spawnT: 1.4, grace: 0,
    player: actor(0, 0, c.player),
    companions: [],
    naturalCompanion: false,
    hostage, boss,
    enemies: [], shots: [], bullets: [], orbs: [], missiles: [],
    xp: 0,
    gun: { damagePercent: 0, fireRatePercent: 0, pierce: 0, pump: false },
    hint: null,
    events: [],
  };
}

function emit(s, type, data = {}) {
  s.events.push({ type, ...data });
}

function nearestEnemy(s, from, range) {
  let best = null;
  let bestD = range;
  for (const e of s.enemies) {
    const d = dist(from, e);
    if (d < bestD) { best = e; bestD = d; }
  }
  for (const m of s.missiles) {
    if (m.kind !== 'rocket') continue;
    const d = dist(from, m) * ROCKET_PRIORITY;
    if (d < bestD) { best = m; bestD = d; }
  }
  if (s.boss.alive) {
    const d = dist(from, s.boss) - s.boss.r * 0.6;
    if (d < bestD) best = s.boss;
  }
  return best;
}

/** The player's current gun, after upgrades. */
function playerWeapon(s) {
  const ch = s.cfg.characters.player;
  const { damagePercent, fireRatePercent, pierce, pump } = s.gun;
  const damage = ch.damage * (1 + damagePercent / 100);
  const fireInterval = ch.fireInterval / (1 + fireRatePercent / 100);
  if (!pump) return { damage, fireInterval, pierce };
  return {
    damage: damage * PLAYER_PUMP.damageFactor,
    fireInterval: fireInterval * PLAYER_PUMP.intervalFactor,
    pierce,
    pellets: PLAYER_PUMP.pellets,
    spread: PLAYER_PUMP.spread,
    ttl: PLAYER_PUMP.ttl,
  };
}

function fireAt(s, shooter, weapon, dt) {
  shooter.cool -= dt;
  if (shooter.cool > 0) return;
  const reach = weapon.ttl ? weapon.ttl * SHOT_SPEED : Infinity;
  const target = nearestEnemy(s, shooter, Math.min(s.cfg.gameplay.attackRange, reach));
  if (!target) return;
  shooter.cool = weapon.fireInterval;
  const lead = dist(shooter, target) / SHOT_SPEED;
  const dx = target.x + target.vx * lead - shooter.x;
  const dy = target.y + target.vy * lead - shooter.y;
  pushShots(s, shooter, weapon, Math.atan2(dy, dx));
}

function pushShots(s, shooter, weapon, angle) {
  const pellets = weapon.pellets ?? 1;
  for (let i = 0; i < pellets; i++) {
    const a = angle + (i - (pellets - 1) / 2) * (weapon.spread ?? 0);
    s.shots.push({
      x: shooter.x, y: shooter.y,
      vx: Math.cos(a) * SHOT_SPEED, vy: Math.sin(a) * SHOT_SPEED,
      ttl: weapon.ttl ?? 0.95, damage: weapon.damage, ally: shooter !== s.player,
      pierce: weapon.pierce ?? 0,
    });
  }
  emit(s, 'shot', { role: shooter === s.player ? 'player' : 'companion', x: shooter.x, y: shooter.y });
}

/** Aim stick held: fire that way even with no enemy in range. */
function fireAimed(s, shooter, weapon, aim, dt) {
  shooter.cool -= dt;
  if (shooter.cool > 0) return;
  shooter.cool = weapon.fireInterval;
  pushShots(s, shooter, weapon, Math.atan2(aim.y, aim.x));
}

/** A lit wedge that contains the hostage's real direction without being centred on it. */
function lightHint(s) {
  const { hintSpread, hintSeconds } = s.cfg.gameplay;
  const truth = Math.atan2(s.hostage.y - s.player.y, s.hostage.x - s.player.x);
  const spread = hintSpread * DEG;
  const offset = (s.rng() - 0.5) * spread * 0.8;
  s.hint = { angle: truth + offset, spread, ttl: hintSeconds, total: hintSeconds };
  emit(s, 'hint');
}

function killEnemy(s, e) {
  s.kills += 1;
  s.player.hp = Math.min(s.player.maxHp, s.player.hp + KILL_HEAL[e.kind]);
  emit(s, 'kill', { x: e.x, y: e.y, kind: e.kind });
  if (e.xp > 0) s.orbs.push({ x: e.x, y: e.y, xp: e.xp });
  if (s.hostage) lightHint(s);
  updateDifficulty(s);
}

/** Enemy health, damage and XP are multiplied by this; additive per level, like the damage upgrade. */
function enemyFactor(s) {
  return 1 + ((s.level - 1) * s.cfg.gameplay.difficultyIncrease) / 100;
}

function updateDifficulty(s) {
  const level = 1 + Math.floor(s.kills / s.cfg.gameplay.difficultyKills);
  if (level === s.level) return;
  s.level = level;
  // Spawns pick up the new level as they appear, but the boss already exists and has to be brought up to it.
  const b = s.boss;
  const ch = s.cfg.characters.boss;
  const factor = enemyFactor(s);
  const health = b.hp / b.maxHp;
  b.maxHp = ch.hp * factor;
  b.hp = b.maxHp * health;
  emit(s, 'difficulty', { level });
}

function hurtEnemy(s, e, damage) {
  e.hp -= damage;
  e.flash = 0.09;
  if (e === s.boss && e.mode !== 'fight') wakeBoss(s);
  if (e.hp > 0) return false;
  if (e === s.boss) {
    e.alive = false;
    s.bullets.length = 0;
    s.enemies.length = 0;
    s.missiles.length = 0;
    emit(s, 'bossDead', { x: e.x, y: e.y });
  } else {
    killEnemy(s, e);
  }
  return true;
}

function hurtPlayer(s, damage) {
  if (s.grace > 0 || s.status !== 'playing') return;
  s.player.hp -= damage;
  s.player.flash = 0.14;
  s.grace = PLAYER_GRACE;
  emit(s, 'hurt');
  if (s.player.hp <= 0) {
    s.player.hp = 0;
    s.status = 'lost';
    emit(s, 'lose');
  }
}

function hurtCompanion(s, m, damage) {
  m.hp -= damage;
  m.flash = 0.14;
  if (m.hp <= 0) {
    m.hp = 0;
    m.down = 9;
    emit(s, 'companionDown', { x: m.x, y: m.y });
  }
}

function wakeBoss(s) {
  if (s.boss.mode === 'fight') return;
  s.boss.mode = 'fight';
  emit(s, 'bossWake');
}

function spawnEnemy(s) {
  const { cfg, player, hostage, view, rng } = s;
  const g = cfg.gameplay;
  const angle = rng() * TAU;
  const ring = Math.hypot(view.halfW, view.halfH) + 90;
  const x = player.x + Math.cos(angle) * ring;
  const y = player.y + Math.sin(angle) * ring;
  if (hostage && Math.hypot(x - hostage.x, y - hostage.y) < g.arenaRadius + 60) return;
  const kind = chooseSpawn(s);
  if (!kind) return;
  if (kind === 'jet') {
    spawnJet(s, x, y);
    return;
  }
  const e = addEnemy(s, kind, x, y);
  const ch = cfg.characters[kind];
  e.speed = ch.speed * (0.92 + rng() * 0.16);
  e.attack = kind === 'enemy5' ? 'ball' : ch.attackType;
  if (e.attack === 'boss') Object.assign(e, bossTimers());
  if (kind === 'enemy5') {
    e.ballT = ch.fireInterval;
    emit(s, 'enemy5');
  }
  if (kind === 'boss') emit(s, 'bossSpawn');
}

const countOf = (s, kind) => s.enemies.filter((e) => e.kind === kind).length;

/** Whether this character's own limits allow one more right now. The Rescue boss is the guardian, never a spawn. */
function canSpawn(s, kind) {
  const { firstSpawn, maxAlive } = s.cfg.characters[kind];
  if (kind === 'boss' && s.mode !== 'endless') return false;
  return s.time >= firstSpawn && (!maxAlive || countOf(s, kind) < maxAlive);
}

/** Every spawn picks one character in proportion to the rates, so 0.30 appears twice as often as 0.15. */
function chooseSpawn(s) {
  const c = s.cfg.characters;
  const pool = ['enemy5', 'enemy1', 'enemy2', 'jet', 'boss'].filter((kind) => c[kind].enabled && c[kind].spawnChance > 0 && canSpawn(s, kind));
  const total = pool.reduce((sum, kind) => sum + c[kind].spawnChance, 0);
  if (!total) return null;
  let roll = s.rng() * total;
  for (const kind of pool) {
    roll -= c[kind].spawnChance;
    if (roll < 0) return kind;
  }
  return pool.at(-1);
}

/** A new enemy at the current difficulty level. */
function addEnemy(s, kind, x, y) {
  const ch = s.cfg.characters[kind];
  const factor = enemyFactor(s);
  const e = actor(x, y, { size: ch.size, hp: ch.hp * factor });
  Object.assign(e, { kind, size: ch.size, speed: ch.speed, damage: (ch.damage ?? 0) * factor, xp: Math.round((ch.xp ?? ch.endlessXp) * factor) });
  s.enemies.push(e);
  return e;
}

/** The jet crosses the view in a straight line, passing near the player, and leaves. */
function spawnJet(s, x, y) {
  const { player, view, rng } = s;
  const ch = s.cfg.characters.jet;
  const e = addEnemy(s, 'jet', x, y);
  const heading = Math.atan2(player.y + (rng() - 0.5) * 300 - y, player.x + (rng() - 0.5) * 300 - x);
  e.heading = heading;
  e.vx = Math.cos(heading) * ch.speed;
  e.vy = Math.sin(heading) * ch.speed;
  e.life = Math.min(JET_MAX_LIFE, (2 * Math.hypot(view.halfW, view.halfH) + 400) / (ch.speed || 1));
  emit(s, 'jet');
}

function launchMissile(s, jet) {
  const ch = s.cfg.characters.missile;
  s.missiles.push({
    x: jet.x, y: jet.y,
    vx: jet.vx, vy: jet.vy,
    heading: jet.heading,
    r: radius(ch.size), damage: ch.damage * enemyFactor(s), ttl: MISSILE_TTL,
  });
  emit(s, 'shot', { role: 'jet', x: jet.x, y: jet.y });
}

/** Puts a Rocketeer on every bus coming into view. A killed crew stays in crewedBuses, so it never returns. */
function updateBusCrews(s) {
  const ch = s.cfg.characters.rocketeer;
  if (s.world?.kind !== 'wasteland' || !ch.enabled || s.time < ch.firstSpawn) return;
  let crews = countOf(s, 'rocketeer');
  const { player: p, view } = s;
  const w = view.halfW + BUS_SCAN_MARGIN;
  const h = view.halfH + BUS_SCAN_MARGIN;
  forEachItemIn(s.world, p.x - w, p.y - h, p.x + w, p.y + h, (item) => {
    if (item.kind !== 'bus' || s.crewedBuses.has(item.id) || (ch.maxAlive && crews >= ch.maxAlive)) return;
    crews += 1;
    s.crewedBuses.add(item.id);
    const e = addEnemy(s, 'rocketeer', item.x, item.y);
    e.busId = item.id;
    e.cool = 0.6 + item.variant * s.cfg.characters.rocketeer.fireInterval; // so buses do not all fire together
    if (!s.rocketeerSeen) emit(s, 'rocketeer');
    s.rocketeerSeen = true;
  });
}

function launchRocket(s, e) {
  const ch = s.cfg.characters.rocket;
  const heading = Math.atan2(s.player.y - e.y, s.player.x - e.x);
  s.missiles.push({
    kind: 'rocket',
    x: e.x, y: e.y,
    vx: Math.cos(heading) * ch.speed, vy: Math.sin(heading) * ch.speed,
    heading,
    r: radius(ch.size), damage: ch.damage * enemyFactor(s), ttl: MISSILE_TTL,
  });
  emit(s, 'shot', { role: 'rocketeer', x: e.x, y: e.y });
}

function updateRocketeer(s, e, dt) {
  e.flash = Math.max(0, e.flash - dt);
  e.cool -= dt;
  if (e.cool > 0 || !onScreen(s, e)) return;
  e.cool = s.cfg.characters.rocketeer.fireInterval;
  launchRocket(s, e);
}

function updateJet(s, e, dt) {
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  e.flash = Math.max(0, e.flash - dt);
  e.life -= dt;
  e.cool -= dt;
  if (e.cool <= 0 && onScreen(s, e)) {
    e.cool = s.cfg.characters.jet.fireInterval;
    launchMissile(s, e);
  }
}

/**
 * A click or tap at a world position destroys the nearest missile within reach. It is the only way to
 * destroy one: bullets pass through. Returns whether a missile was hit.
 */
export function destroyMissileAt(s, x, y, reach) {
  if (s.status !== 'playing') return false;
  const point = { x, y };
  let best = -1;
  let bestD = Infinity;
  s.missiles.forEach((m, index) => {
    const d = dist(m, point);
    if (d <= Math.max(reach, m.r) && d < bestD) { best = index; bestD = d; }
  });
  if (best < 0) return false;
  const [m] = s.missiles.splice(best, 1);
  emit(s, 'missileDown', { x: m.x, y: m.y });
  return true;
}

function updateMissiles(s, dt) {
  for (let i = s.missiles.length - 1; i >= 0; i--) {
    const m = s.missiles[i];
    const { speed } = s.cfg.characters[m.kind === 'rocket' ? 'rocket' : 'missile'];
    m.ttl -= dt;
    const wanted = Math.atan2(s.player.y - m.y, s.player.x - m.x);
    const turn = Math.atan2(Math.sin(wanted - m.heading), Math.cos(wanted - m.heading));
    m.heading += Math.sign(turn) * Math.min(Math.abs(turn), MISSILE_TURN_RATE * dt);
    m.vx = Math.cos(m.heading) * speed;
    m.vy = Math.sin(m.heading) * speed;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    const companion = s.companions.find((c) => !c.down && dist(m, c) < m.r + c.r);
    if (dist(m, s.player) < m.r + s.player.r) hurtPlayer(s, m.damage);
    else if (companion) hurtCompanion(s, companion, m.damage * 0.6);
    else if (m.ttl > 0) continue;
    emit(s, 'missileDown', { x: m.x, y: m.y });
    s.missiles.splice(i, 1);
  }
}

function updateSpawning(s, dt) {
  if (s.hostage && s.cfg.characters.boss.enabled && !s.boss.alive) return;
  s.spawnT -= dt;
  if (s.spawnT > 0) return;
  const base = s.cfg.gameplay.spawnInterval;
  const interval = Math.max(base * FASTEST_SPAWN_FACTOR, base * (1 - s.time / 260));
  s.spawnT = interval * (s.boss.mode === 'fight' ? 2.2 : 1);
  const roaming = s.enemies.filter((e) => e.kind !== 'rocketeer').length; // bus crews must not crowd out spawns
  if (roaming < s.cfg.gameplay.maxEnemies) spawnEnemy(s);
}

function addCompanion(s) {
  const m = { ...actor(s.player.x - 60, s.player.y + 40, s.cfg.characters.companion), down: 0 };
  s.companions.push(m);
  emit(s, 'companion', { x: m.x, y: m.y });
}

function maybeSpawnCompanion(s) {
  if (s.naturalCompanion || !s.cfg.characters.companion.enabled) return;
  const g = s.cfg.gameplay;
  const nearHostage = s.hostage && dist(s.player, s.hostage) <= g.companionDistance;
  if (s.kills < g.companionKills && !nearHostage) return;
  s.naturalCompanion = true;
  addCompanion(s);
}

function updateCompanion(s, m, index, dt) {
  const ch = s.cfg.characters.companion;
  if (m.down > 0) {
    m.down -= dt;
    if (m.down <= 0) {
      m.down = 0;
      m.hp = m.maxHp;
      m.x = s.player.x - 50;
      m.y = s.player.y + 40;
      emit(s, 'companion', { x: m.x, y: m.y, revived: true });
    }
    return;
  }
  m.flash = Math.max(0, m.flash - dt);
  // Companions spread around the player instead of stacking on one spot.
  const slot = (index / s.companions.length) * TAU + Math.PI * 0.75;
  const post = { x: s.player.x + Math.cos(slot) * 90, y: s.player.y + Math.sin(slot) * 90 };
  const away = dist(m, post);
  const follow = Math.min(1, away / 80);
  const dx = (post.x - m.x) / (away || 1);
  const dy = (post.y - m.y) / (away || 1);
  m.vx = dx * ch.speed * follow;
  m.vy = dy * ch.speed * follow;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  pushOutOfSolids(s.world, m, dt);
  if (Math.abs(m.vx) > 5) m.face = Math.sign(m.vx);
  fireAt(s, m, ch, dt);
}

function chaseTarget(s, e) {
  let best = s.player;
  let bestD = dist(e, s.player);
  for (const m of s.companions) {
    if (m.down) continue;
    const d = dist(e, m) * 1.25;
    if (d < bestD) { best = m; bestD = d; }
  }
  return best;
}

/** Ranged enemies only shoot from where the player can see them. */
function onScreen(s, e) {
  return Math.abs(e.x - s.player.x) < s.view.halfW * 0.92 && Math.abs(e.y - s.player.y) < s.view.halfH * 0.92;
}

function rangedPace(s, e, spec, d) {
  if (e.windup > 0) return 0;
  if (d > spec.range || !onScreen(s, e)) return 1;
  return spec.retreat && d < spec.range * 0.55 ? -0.6 : 0;
}

function updateRangedAttack(s, e, target, spec, d, dt) {
  e.cool -= dt;
  if (e.windup > 0) {
    e.windup -= dt;
    if (e.windup > 0) return;
    emit(s, 'shot', { role: e.kind, x: e.x, y: e.y });
    for (let i = 0; i < spec.pellets; i++) {
      const angle = e.aim + (i - (spec.pellets - 1) / 2) * spec.spread;
      s.bullets.push({
        x: e.x, y: e.y,
        vx: Math.cos(angle) * spec.speed, vy: Math.sin(angle) * spec.speed,
        ttl: spec.ttl, r: spec.r, damage: e.damage,
      });
    }
    return;
  }
  if (e.cool <= 0 && d <= spec.range * 1.1 && onScreen(s, e)) {
    e.cool = spec.interval;
    e.windup = spec.windup;
    e.aim = Math.atan2(target.y - e.y, target.x - e.x); // locked now, so a moving player can dodge
  }
}

/** Enemy 5 walks like a melee enemy and throws a large ball on a fixed timer, showing the line first. */
function updateBallAttack(s, e, target, dt) {
  const { fireInterval } = s.cfg.characters.enemy5;
  const telegraph = Math.min(BALL_TELEGRAPH, fireInterval / 2);
  e.ballT -= dt;
  if (!onScreen(s, e)) {
    e.ballT = Math.max(e.ballT, telegraph);
    e.windup = 0;
    return;
  }
  if (e.ballT > telegraph) return;
  if (!(e.windup > 0)) e.aim = Math.atan2(target.y - e.y, target.x - e.x);
  e.windup = Math.max(e.ballT, 0.001);
  if (e.ballT > 0) return;
  const ball = s.cfg.characters.ball;
  emit(s, 'shot', { role: e.kind, x: e.x, y: e.y });
  s.bullets.push({
    x: e.x, y: e.y,
    vx: Math.cos(e.aim) * ball.speed, vy: Math.sin(e.aim) * ball.speed,
    ttl: BALL_TTL, r: radius(ball.size), damage: ball.damage * enemyFactor(s), ball: true,
  });
  e.ballT = fireInterval;
  e.windup = 0;
}

/** The sideways push along one axis that keeps enemies from stacking on one spot. */
function spreadFromOthers(s, e, axis) {
  let push = 0;
  for (const other of s.enemies) {
    if (other === e || other.kind === 'jet' || other.kind === 'rocketeer') continue; // in the air, or up on a bus
    const od = Math.hypot(e.x - other.x, e.y - other.y);
    if (od > 0 && od < e.r + other.r) push += ((e[axis] - other[axis]) / od) * 110;
  }
  return push;
}

/** A regular enemy using the Boss attack: it fights like the guardian, but only opens fire where the player can see it. */
function updateBossAttacker(s, e, dt) {
  const d = dist(e, s.player) || 1;
  bossMoves(s, e, { speed: e.speed, damage: e.damage, attack: 'pump' }, onScreen(s, e), dt);
  e.vx += spreadFromOthers(s, e, 'x');
  e.vy += spreadFromOthers(s, e, 'y');
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  pushOutOfSolids(s.world, e, dt);
  if (Math.abs(e.vx) > 5) e.face = Math.sign(e.vx);
  e.flash = Math.max(0, e.flash - dt);
  bossContact(s, e, e.damage * BOSS_CONTACT_FACTOR, d, dt);
}

function updateEnemies(s, dt) {
  for (let i = s.enemies.length - 1; i >= 0; i--) {
    const e = s.enemies[i];
    if (dist(e, s.player) > DESPAWN_DISTANCE) {
      s.enemies.splice(i, 1);
      s.crewedBuses.delete(e.busId); // walked away from, not killed: it is back on its bus next time
      continue;
    }
    if (e.kind === 'rocketeer') {
      updateRocketeer(s, e, dt);
      continue;
    }
    if (e.kind === 'jet') {
      updateJet(s, e, dt);
      if (e.life <= 0) s.enemies.splice(i, 1);
      continue;
    }
    if (e.attack === 'boss') {
      updateBossAttacker(s, e, dt);
      continue;
    }
    const target = chaseTarget(s, e);
    const d = dist(e, target) || 1;
    const spec = RANGED[e.attack];
    const pace = spec ? rangedPace(s, e, spec, d) : 1;
    const vx = ((target.x - e.x) / d) * e.speed * pace + spreadFromOthers(s, e, 'x');
    const vy = ((target.y - e.y) / d) * e.speed * pace + spreadFromOthers(s, e, 'y');
    e.vx = vx;
    e.vy = vy;
    e.x += vx * dt;
    e.y += vy * dt;
    pushOutOfSolids(s.world, e, dt);
    if (Math.abs(vx) > 5) e.face = Math.sign(vx);
    e.flash = Math.max(0, e.flash - dt);
    if (e.attack === 'ball') updateBallAttack(s, e, target, dt);
    if (spec) {
      updateRangedAttack(s, e, target, spec, d, dt);
      continue;
    }
    const touching = d < e.r + target.r;
    if (e.attack === 'kamikaze' && touching) {
      hitTarget(s, target, e.damage);
      emit(s, 'kamikaze', { role: e.kind, x: e.x, y: e.y });
      s.enemies.splice(i, 1); // spent, not killed: no kill, no XP
      continue;
    }
    e.cool -= dt;
    if (e.cool <= 0 && touching) {
      e.cool = 0.75;
      emit(s, 'shot', { role: e.kind, x: e.x, y: e.y });
      hitTarget(s, target, e.damage);
    }
  }
}

function hitTarget(s, target, damage) {
  if (target === s.player) hurtPlayer(s, damage);
  else hurtCompanion(s, target, damage);
}

function fireBossBullet(s, b, damage, angle, speed = BOSS_BULLET_SPEED) {
  s.bullets.push({
    x: b.x, y: b.y,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    ttl: 3.2, r: 9, damage,
  });
}

/**
 * The boss's way of fighting, for the guardian and for anything using the Boss attack: walks at the player,
 * fires by `attack`, charges now and then, and speeds up when badly hurt. Sets the velocity; the caller moves.
 */
function bossMoves(s, b, { speed, damage, attack }, canAttack, dt) {
  const enraged = b.hp < b.maxHp * 0.5;
  const pace = enraged ? 1.45 : 1;
  const d = dist(b, s.player) || 1;
  const toPlayer = Math.atan2(s.player.y - b.y, s.player.x - b.x);
  const shout = () => emit(s, 'shot', { role: b.kind, x: b.x, y: b.y });

  if (b.windup > 0) {
    b.windup -= dt;
    b.vx = 0;
    b.vy = 0;
    if (b.windup <= 0) {
      b.dash = 0.55;
      b.dashX = Math.cos(toPlayer);
      b.dashY = Math.sin(toPlayer);
    }
    return;
  }
  if (b.dash > 0) {
    b.dash -= dt;
    b.vx = b.dashX * speed * 4.6;
    b.vy = b.dashY * speed * 4.6;
    return;
  }
  b.vx = ((s.player.x - b.x) / d) * speed;
  b.vy = ((s.player.y - b.y) / d) * speed;
  if (!canAttack) return;
  b.fanT -= dt * pace;
  b.ringT -= dt * pace;
  b.chargeT -= dt * pace;
  if (attack === 'sniper' && b.fanT <= 0) {
    b.fanT = 0.85;
    shout();
    fireBossBullet(s, b, damage, toPlayer, BOSS_BULLET_SPEED * 2.1);
  }
  if (attack === 'pump' && b.fanT <= 0) {
    b.fanT = 1.5;
    shout();
    const count = enraged ? 7 : 5;
    for (let i = 0; i < count; i++) fireBossBullet(s, b, damage, toPlayer + (i - (count - 1) / 2) * 0.2);
  }
  if (attack === 'pump' && b.ringT <= 0) {
    b.ringT = 4.2;
    shout();
    const start = s.rng() * TAU;
    for (let i = 0; i < 16; i++) fireBossBullet(s, b, damage, start + (i / 16) * TAU, BOSS_BULLET_SPEED * 0.8);
  }
  if (b.chargeT <= 0) {
    b.chargeT = attack === 'melee' ? 3.2 : 5.5;
    b.windup = 0.7;
    emit(s, 'bossCharge');
  }
}

function bossContact(s, b, damage, d, dt) {
  b.cool -= dt;
  if (b.cool <= 0 && d < b.r + s.player.r) {
    b.cool = 0.75;
    hurtPlayer(s, damage);
  }
  for (const m of s.companions) {
    if (m.down || b.cool > 0 || dist(b, m) >= b.r + m.r) continue;
    b.cool = 0.75;
    hurtCompanion(s, m, damage);
  }
}

function updateBoss(s, dt) {
  const b = s.boss;
  if (!b.alive) return;
  b.flash = Math.max(0, b.flash - dt);
  const ch = s.cfg.characters.boss;
  const arena = s.cfg.gameplay.arenaRadius;
  const fromHome = dist(s.player, s.hostage);
  const home = { x: s.hostage.x, y: s.hostage.y - arena * 0.4 };

  if (b.mode === 'idle') {
    if (fromHome < arena) wakeBoss(s);
    return;
  }
  if (b.mode === 'fight' && fromHome > arena * LEASH_FACTOR) {
    b.mode = 'return';
    b.dash = 0;
    b.windup = 0;
    emit(s, 'bossRetreat');
  }
  if (b.mode === 'return') {
    const d = dist(b, home);
    if (d < 8) {
      b.mode = 'idle';
      b.hp = b.maxHp;
    } else {
      b.vx = ((home.x - b.x) / d) * ch.speed * 1.6;
      b.vy = ((home.y - b.y) / d) * ch.speed * 1.6;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.12 * dt);
    if (fromHome < arena) wakeBoss(s);
    return;
  }

  const d = dist(b, s.player) || 1;
  const damage = ch.damage * enemyFactor(s);
  // For the guardian the Boss attack is simply its usual fan, ring and charge.
  const attack = ch.attackType === 'boss' ? 'pump' : ch.attackType;
  bossMoves(s, b, { speed: ch.speed, damage, attack }, true, dt);

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  // The boss guards the hostage: it never leaves the arena.
  const fromCentre = dist(b, s.hostage);
  if (fromCentre > arena) {
    b.x = s.hostage.x + ((b.x - s.hostage.x) / fromCentre) * arena;
    b.y = s.hostage.y + ((b.y - s.hostage.y) / fromCentre) * arena;
    b.dash = 0;
  }
  if (Math.abs(b.vx) > 5) b.face = Math.sign(b.vx);
  bossContact(s, b, damage * BOSS_CONTACT_FACTOR, d, dt);
}

function updateShots(s, dt) {
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const p = s.shots[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ttl -= dt;
    if (hitsSolid(s.world, p.x, p.y)) {
      emit(s, 'impact', { x: p.x, y: p.y });
      s.shots.splice(i, 1);
      continue;
    }
    // A shot stops at its first enemy unless it still has pierce left, and hits each enemy once.
    let spent = false;
    const strike = (e) => {
      (p.struck ??= new Set()).add(e);
      if ((p.pierce ?? 0) > 0) p.pierce -= 1;
      else spent = true;
      return hurtEnemy(s, e, p.damage);
    };
    for (let j = s.enemies.length - 1; j >= 0 && !spent; j--) {
      const e = s.enemies[j];
      if (!p.struck?.has(e) && dist(p, e) < e.r + 6 && strike(e)) s.enemies.splice(j, 1);
    }
    if (!spent && interceptRocket(s, p)) spent = true;
    if (!spent && s.boss.alive && !p.struck?.has(s.boss) && dist(p, s.boss) < s.boss.r + 6) strike(s.boss);
    if (spent || p.ttl <= 0) s.shots.splice(i, 1);
  }
}

/** Rockets can be shot down. Kh-29 missiles cannot: only a click or tap destroys those. */
function interceptRocket(s, shot) {
  const index = s.missiles.findIndex((m) => m.kind === 'rocket' && dist(shot, m) < m.r + 6);
  if (index < 0) return false;
  const [rocket] = s.missiles.splice(index, 1);
  emit(s, 'missileDown', { x: rocket.x, y: rocket.y });
  return true;
}

function updateBullets(s, dt) {
  for (let i = s.bullets.length - 1; i >= 0; i--) {
    const b = s.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.ttl -= dt;
    if (!b.ball && hitsSolid(s.world, b.x, b.y)) { // the large ball rolls straight through cover
      emit(s, 'impact', { x: b.x, y: b.y });
      s.bullets.splice(i, 1);
      continue;
    }
    let hit = false;
    if (dist(b, s.player) < b.r + s.player.r) {
      hurtPlayer(s, b.damage);
      hit = true;
    } else {
      const m = s.companions.find((c) => !c.down && dist(b, c) < b.r + c.r);
      if (m) {
        hurtCompanion(s, m, b.damage * 0.6);
        hit = true;
      }
    }
    if (hit || b.ttl <= 0) s.bullets.splice(i, 1);
  }
}

function checkLevelUp(s) {
  const need = s.cfg.gameplay.xpToUpgrade;
  if (s.status !== 'playing' || s.xp < need) return;
  s.xp -= need;
  s.status = 'levelup';
  emit(s, 'levelUp');
}

function updateOrbs(s, dt) {
  const p = s.player;
  for (let i = s.orbs.length - 1; i >= 0; i--) {
    const o = s.orbs[i];
    const d = dist(o, p);
    if (d > DESPAWN_DISTANCE) {
      s.orbs.splice(i, 1);
    } else if (d < p.r + ORB_PICKUP) {
      s.xp += o.xp;
      s.orbs.splice(i, 1);
      emit(s, 'xp', { x: o.x, y: o.y });
    } else if (d < ORB_MAGNET) {
      o.x += ((p.x - o.x) / d) * ORB_SPEED * dt;
      o.y += ((p.y - o.y) / d) * ORB_SPEED * dt;
    }
  }
  checkLevelUp(s);
}

/** The upgrades on offer right now. */
export function availableUpgrades(s) {
  const ids = ['damage', 'fireRate', 'health', 'companion', 'pierce'];
  if (s.companions.length >= MAX_COMPANIONS || !s.cfg.characters.companion.enabled) ids.splice(ids.indexOf('companion'), 1);
  if (!s.gun.pump) ids.unshift('pump');
  return ids;
}

/** Applies a choice from the level-up menu and resumes the game. Returns false if it was not on offer. */
export function applyUpgrade(s, id) {
  if (s.status !== 'levelup' || !availableUpgrades(s).includes(id)) return false;
  const g = s.cfg.gameplay;
  if (id === 'pump') s.gun.pump = true;
  if (id === 'damage') s.gun.damagePercent += g.upgradeDamage;
  if (id === 'fireRate') s.gun.fireRatePercent += g.upgradeFireRate;
  if (id === 'pierce') s.gun.pierce += 1;
  if (id === 'companion') addCompanion(s);
  if (id === 'health') {
    s.player.maxHp += g.upgradeHealth;
    s.player.hp += g.upgradeHealth;
  }
  s.status = 'playing';
  checkLevelUp(s); // XP left over can already pay for the next one
  return true;
}

function updateRescue(s) {
  if (!s.hostage) return;
  if (dist(s.player, s.hostage) >= s.player.r + s.hostage.r + RESCUE_GAP) {
    s.lockedNoticeShown = false;
    return;
  }
  if (s.boss.alive) {
    if (!s.lockedNoticeShown) emit(s, 'hostageLocked');
    s.lockedNoticeShown = true;
    return;
  }
  s.status = 'won';
  emit(s, 'win');
}

/** Advances the game by dt seconds. input is { x, y } to move and optional { aimX, aimY } to aim. */
export function step(s, dt, input) {
  if (s.status !== 'playing') return;
  s.time += dt;
  s.grace = Math.max(0, s.grace - dt);

  const ch = s.cfg.characters.player;
  const p = s.player;
  const mag = Math.hypot(input.x, input.y);
  const scale = mag > 1 ? 1 / mag : 1;
  p.vx = input.x * scale * ch.speed;
  p.vy = input.y * scale * ch.speed;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  pushOutOfSolids(s.world, p, dt);
  if (Math.abs(p.vx) > 5) p.face = Math.sign(p.vx);
  p.flash = Math.max(0, p.flash - dt);

  const aimLength = Math.hypot(input.aimX ?? 0, input.aimY ?? 0);
  p.aim = aimLength > 0 ? { x: input.aimX / aimLength, y: input.aimY / aimLength } : null;
  if (p.aim && Math.abs(p.aim.x) > 0.05) p.face = Math.sign(p.aim.x);

  if (s.hint) {
    s.hint.ttl -= dt;
    if (s.hint.ttl <= 0) s.hint = null;
  }

  maybeSpawnCompanion(s);
  updateSpawning(s, dt);
  updateBusCrews(s);
  const weapon = playerWeapon(s);
  if (p.aim) fireAimed(s, p, weapon, p.aim, dt);
  else fireAt(s, p, weapon, dt);
  s.companions.forEach((m, index) => updateCompanion(s, m, index, dt));
  updateEnemies(s, dt);
  updateBoss(s, dt);
  updateShots(s, dt);
  updateBullets(s, dt);
  updateMissiles(s, dt);
  if (s.status === 'playing') updateOrbs(s, dt);
  if (s.status === 'playing') updateRescue(s);
}
