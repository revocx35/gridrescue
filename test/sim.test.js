import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig } from '../public/js/schema.js';
import { createGame, step } from '../public/js/sim.js';

const DT = 1 / 60;

function seeded(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function game(seed = 1, edit = () => {}) {
  const cfg = defaultConfig();
  edit(cfg);
  return createGame(cfg, { rng: seeded(seed) });
}

const still = { x: 0, y: 0 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function placeEnemy(s, kind, x, y) {
  const ch = s.cfg.characters[kind];
  const e = { x, y, vx: 0, vy: 0, hp: ch.hp, maxHp: ch.hp, r: ch.size * 0.42, cool: 0, flash: 0, face: 1, kind, speed: ch.speed, damage: ch.damage };
  s.enemies.push(e);
  return e;
}

/** Steers toward a point; once the arena is reached, circles the boss at range. */
function bot(s) {
  const target = !s.boss.alive ? s.hostage : dist(s.player, s.hostage) > s.cfg.gameplay.arenaRadius * 0.9 ? s.hostage : null;
  if (target) {
    const d = dist(s.player, target) || 1;
    return { x: (target.x - s.player.x) / d, y: (target.y - s.player.y) / d };
  }
  const d = dist(s.player, s.boss) || 1;
  const radial = (330 - d) / 200;
  const nx = (s.player.x - s.boss.x) / d;
  const ny = (s.player.y - s.boss.y) / d;
  return { x: -ny + nx * radial, y: nx + ny * radial };
}

describe('world', () => {
  it('places the hostage far from the start', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = game(seed);
      assert.ok(dist(s.player, s.hostage) >= s.cfg.gameplay.hostageDistance * 0.85);
    }
  });

  it('has no edge: the player keeps moving at any distance', () => {
    const s = game();
    s.player.x = 5_000_000;
    s.hostage.x = -5_000_000;
    s.boss.x = -5_000_000;
    s.spawnT = 1e9;
    step(s, 1, { x: 1, y: 0 });
    assert.equal(s.player.x, 5_000_000 + s.cfg.characters.player.speed);
  });

  it('normalises diagonal input so it is not faster', () => {
    const s = game();
    s.spawnT = 1e9;
    step(s, 1, { x: 1, y: 1 });
    assert.ok(Math.abs(Math.hypot(s.player.x, s.player.y) - s.cfg.characters.player.speed) < 1e-6);
  });
});

describe('spawning', () => {
  it('spawns enemy 1 more rarely than enemy 2, and stronger', () => {
    const s = game(7);
    const seen = { enemy1: 0, enemy2: 0 };
    s.cfg.gameplay.maxEnemies = 1e6;
    const known = new Set();
    for (let i = 0; i < 60 * 240; i++) {
      s.player.hp = s.player.maxHp;
      s.player.x = 0;
      s.player.y = 0;
      step(s, DT, still);
      for (const e of s.enemies) {
        if (!known.has(e)) { known.add(e); seen[e.kind] += 1; e.cool = 1e9; }
      }
      s.enemies.length = Math.min(s.enemies.length, 0);
    }
    assert.ok(seen.enemy2 > seen.enemy1 * 3, JSON.stringify(seen));
    assert.ok(seen.enemy1 > 0);
    const { enemy1, enemy2 } = s.cfg.characters;
    assert.ok(enemy1.hp > enemy2.hp && enemy1.damage > enemy2.damage);
  });

  it('spawns off screen', () => {
    const s = game(3);
    s.spawnT = 0;
    step(s, DT, still);
    const [e] = s.enemies;
    assert.ok(Math.abs(e.x) > s.view.halfW || Math.abs(e.y) > s.view.halfH);
  });

  it('respects the enemy cap', () => {
    const s = game(5, (c) => { c.gameplay.maxEnemies = 3; c.gameplay.spawnInterval = 0.1; c.characters.player.damage = 0; });
    for (let i = 0; i < 60 * 20; i++) {
      s.player.hp = s.player.maxHp;
      step(s, DT, still);
    }
    assert.ok(s.enemies.length <= 3);
  });

  it('drops enemies the player has escaped from', () => {
    const s = game();
    s.spawnT = 1e9;
    placeEnemy(s, 'enemy2', 4000, 0);
    step(s, DT, still);
    assert.equal(s.enemies.length, 0);
  });
});

describe('direction light', () => {
  it('lights up after a kill, covers the true direction, and fades', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = game(seed);
      s.spawnT = 1e9;
      const e = placeEnemy(s, 'enemy2', 60, 0);
      e.hp = 1;
      assert.equal(s.hint, null);
      for (let i = 0; i < 60 && !s.hint; i++) step(s, DT, still);
      assert.ok(s.hint, 'hint appears');
      const truth = Math.atan2(s.hostage.y - s.player.y, s.hostage.x - s.player.x);
      const delta = Math.abs(Math.atan2(Math.sin(truth - s.hint.angle), Math.cos(truth - s.hint.angle)));
      assert.ok(delta <= s.hint.spread / 2, 'true direction is inside the wedge');
      for (let i = 0; i < 60 * (s.cfg.gameplay.hintSeconds + 0.2); i++) step(s, DT, still);
      assert.equal(s.hint, null, 'hint fades');
    }
  });

  it('is deliberately not exact', () => {
    const offsets = new Set();
    for (let seed = 1; seed < 30; seed++) {
      const s = game(seed);
      s.spawnT = 1e9;
      placeEnemy(s, 'enemy2', 60, 0).hp = 1;
      for (let i = 0; i < 60 && !s.hint; i++) step(s, DT, still);
      const truth = Math.atan2(s.hostage.y, s.hostage.x);
      offsets.add(Math.round(Math.atan2(Math.sin(truth - s.hint.angle), Math.cos(truth - s.hint.angle)) * 100));
    }
    assert.ok(offsets.size > 10);
    assert.equal(offsets.has(0) && offsets.size === 1, false);
  });
});

describe('companion', () => {
  it('joins after enough kills', () => {
    const s = game(2, (c) => { c.gameplay.companionKills = 2; });
    s.spawnT = 1e9;
    s.kills = 1;
    step(s, DT, still);
    assert.equal(s.companion, null);
    s.kills = 2;
    step(s, DT, still);
    assert.ok(s.companion);
  });

  it('always joins before the player reaches the hostage', () => {
    const s = game(2, (c) => { c.gameplay.companionKills = 200; });
    s.spawnT = 1e9;
    const d = dist(s.player, s.hostage) || 1;
    const dir = { x: (s.hostage.x - s.player.x) / d, y: (s.hostage.y - s.player.y) / d };
    while (dist(s.player, s.hostage) > s.cfg.gameplay.arenaRadius) {
      s.player.hp = s.player.maxHp;
      step(s, DT, dir);
    }
    assert.ok(s.companion);
  });

  it('follows the player', () => {
    const s = game(4, (c) => { c.gameplay.companionKills = 0; });
    s.spawnT = 1e9;
    for (let i = 0; i < 60 * 4; i++) step(s, DT, { x: 1, y: 0 });
    assert.ok(dist(s.companion, s.player) < 260);
  });

  it('fights: it destroys an enemy on its own', () => {
    const s = game(4, (c) => { c.gameplay.companionKills = 0; c.characters.player.damage = 0; });
    s.spawnT = 1e9;
    step(s, DT, still);
    const e = placeEnemy(s, 'enemy2', s.companion.x + 200, s.companion.y);
    e.speed = 0;
    for (let i = 0; i < 60 * 6 && s.enemies.length; i++) step(s, DT, still);
    assert.equal(s.enemies.length, 0);
    assert.equal(s.kills, 1);
  });

  it('comes back after being downed', () => {
    const s = game(4, (c) => { c.gameplay.companionKills = 0; });
    s.spawnT = 1e9;
    step(s, DT, still);
    s.companion.hp = 1;
    placeEnemy(s, 'enemy2', s.companion.x, s.companion.y).speed = 0;
    s.enemies[0].hp = 1e9;
    s.player.x = s.companion.x + 300;
    s.cfg.characters.player.damage = 0;
    for (let i = 0; i < 30 && !s.companion.down; i++) step(s, DT, still);
    assert.ok(s.companion.down > 0);
    s.enemies.length = 0;
    for (let i = 0; i < 60 * 10; i++) step(s, DT, still);
    assert.equal(s.companion.down, 0);
    assert.equal(s.companion.hp, s.companion.maxHp);
  });
});

describe('boss and rescue', () => {
  function atHostage(seed = 9) {
    const s = game(seed);
    s.spawnT = 1e9;
    s.player.x = s.hostage.x;
    s.player.y = s.hostage.y;
    return s;
  }

  it('cannot be rescued while the boss lives', () => {
    const s = atHostage();
    step(s, DT, still);
    assert.equal(s.status, 'playing');
    assert.ok(s.events.some((e) => e.type === 'hostageLocked'));
  });

  it('wins only after the boss is defeated and the hostage is reached', () => {
    const s = atHostage();
    s.player.x += 900;
    s.boss.hp = 1;
    s.boss.mode = 'fight';
    s.shots.push({ x: s.boss.x, y: s.boss.y, vx: 0, vy: 0, ttl: 1, damage: 10 });
    step(s, DT, still);
    assert.equal(s.boss.alive, false);
    assert.equal(s.status, 'playing');
    s.player.x = s.hostage.x;
    step(s, DT, still);
    assert.equal(s.status, 'won');
  });

  it('stays asleep until the player enters the arena', () => {
    const s = game(9);
    s.spawnT = 1e9;
    for (let i = 0; i < 60; i++) step(s, DT, still);
    assert.equal(s.boss.mode, 'idle');
    s.player.x = s.hostage.x + s.cfg.gameplay.arenaRadius - 10;
    s.player.y = s.hostage.y;
    step(s, DT, still);
    assert.equal(s.boss.mode, 'fight');
  });

  it('never leaves the arena and goes back when the player runs', () => {
    const s = atHostage();
    s.cfg.characters.player.hp = 1e9;
    s.player.hp = s.player.maxHp = 1e9;
    s.cfg.characters.player.damage = 0;
    const arena = s.cfg.gameplay.arenaRadius;
    s.player.x += arena * 0.9;
    for (let i = 0; i < 60 * 25; i++) {
      step(s, DT, still);
      assert.ok(dist(s.boss, s.hostage) <= arena + 1e-6);
    }
    s.player.x = s.hostage.x + arena * 3;
    step(s, DT, still);
    assert.equal(s.boss.mode, 'return');
    for (let i = 0; i < 60 * 20; i++) step(s, DT, still);
    assert.equal(s.boss.mode, 'idle');
    assert.equal(s.boss.hp, s.boss.maxHp);
  });

  it('removes its bullets and stops spawns once defeated', () => {
    const s = atHostage();
    s.player.x += 700;
    s.bullets.push({ x: 1e6, y: 0, vx: 0, vy: 0, ttl: 5, r: 9, damage: 1 });
    s.boss.hp = 1;
    s.shots.push({ x: s.boss.x, y: s.boss.y, vx: 0, vy: 0, ttl: 1, damage: 10 });
    step(s, DT, still);
    assert.equal(s.bullets.length, 0);
    s.spawnT = 0;
    step(s, DT, still);
    assert.equal(s.enemies.length, 0);
  });
});

describe('losing', () => {
  it('ends the game at zero health', () => {
    const s = game();
    s.spawnT = 1e9;
    s.player.hp = 1;
    placeEnemy(s, 'enemy1', 5, 0).speed = 0;
    s.cfg.characters.player.damage = 0;
    for (let i = 0; i < 10; i++) step(s, DT, still);
    assert.equal(s.status, 'lost');
    assert.equal(s.player.hp, 0);
    assert.ok(s.events.some((e) => e.type === 'lose'));
  });

  it('gives brief invulnerability between hits', () => {
    const s = game();
    s.spawnT = 1e9;
    s.cfg.characters.player.damage = 0;
    placeEnemy(s, 'enemy2', 5, 0).speed = 0;
    placeEnemy(s, 'enemy2', -5, 0).speed = 0;
    step(s, DT, still);
    assert.equal(s.player.hp, s.player.maxHp - s.cfg.characters.enemy2.damage);
  });
});

describe('full playthrough', () => {
  it('a simple bot can finish the default game, so it is winnable', () => {
    let wins = 0;
    const results = [];
    for (let seed = 1; seed <= 12; seed++) {
      const s = game(seed * 31);
      let frames = 0;
      while (s.status === 'playing' && frames < 60 * 240) {
        step(s, DT, bot(s));
        frames += 1;
        s.events.length = 0;
      }
      results.push(`${s.status}:${Math.round(s.time)}s/${s.kills}k`);
      if (s.status === 'won') wins += 1;
    }
    assert.ok(wins >= 3, results.join(' '));
    console.log('bot results', results.join(' '));
  });
});
