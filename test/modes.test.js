import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, mapConfig, mapRoles, validateConfig } from '../public/js/schema.js';
import { forEachItemIn, hitsSolid } from '../public/js/scenery.js';
import { createGame, destroyMissileAt, scoreLimits, step } from '../public/js/sim.js';

const DT = 1 / 60;
const still = { x: 0, y: 0 };

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

function game({ map = 'grid', mode = 'rescue', edit = () => {}, seed = 1 } = {}) {
  const cfg = mapConfig(defaultConfig(), map);
  edit(cfg);
  const s = createGame(cfg, { rng: seeded(seed), mode });
  s.cfg.gameplay.spawnInterval = 20;
  s.spawnT = 1000;
  return s;
}

function findBus(s) {
  let bus = null;
  for (let radius = 800; radius < 20000 && !bus; radius += 800) {
    forEachItemIn(s.world, -radius, -radius, radius, radius, (item) => { if (item.kind === 'bus') bus = item; });
  }
  return bus;
}

function crewedGame(options) {
  const s = game({ map: 'wasteland', ...options });
  const bus = findBus(s);
  s.player.x = bus.x + 230;
  s.player.y = bus.y;
  step(s, DT, still);
  const crew = s.enemies.find((e) => e.busId === bus.id);
  return { s, bus, crew };
}

const rocketAt = (s, x, y) => {
  const m = { kind: 'rocket', x, y, vx: 0, vy: 0, heading: 0, r: 18, damage: 28, ttl: 8 };
  s.missiles.push(m);
  return m;
};

describe('roles per map', () => {
  it('has the Rocketeer on the wasteland only', () => {
    assert.ok(mapRoles('wasteland').includes('rocketeer'));
    assert.ok(mapRoles('wasteland').includes('rocket'));
    assert.equal(mapRoles('grid').includes('rocketeer'), false);
    assert.equal('rocketeer' in defaultConfig().maps.forest.characters, false);
  });

  const editable = () => {
    const config = defaultConfig();
    for (const map of Object.values(config.maps)) for (const ch of Object.values(map.characters)) { delete ch.sprite; delete ch.sounds; }
    return config;
  };

  it('rejects a Rocketeer on another map', () => {
    const config = editable();
    config.maps.grid.characters.rocketeer = structuredClone(config.maps.wasteland.characters.rocketeer);
    assert.equal(validateConfig(config).ok, false);
  });

  it('validates sign texts', () => {
    const ok = editable();
    ok.maps.wasteland.signs = ['HELLO', 'WORLD'];
    assert.deepEqual(validateConfig(ok).value.maps.wasteland.signs, ['HELLO', 'WORLD']);
    for (const signs of [['x'.repeat(49)], ['a\u0007b'], Array(21).fill('x'), 'text', [' ']]) {
      const bad = editable();
      bad.maps.wasteland.signs = signs;
      assert.equal(validateConfig(bad).ok, false, JSON.stringify(signs));
    }
  });

  it('allows a map with no signs, and no signs field elsewhere', () => {
    const empty = editable();
    empty.maps.wasteland.signs = [];
    assert.equal(validateConfig(empty).ok, true);
    const stray = editable();
    stray.maps.grid.signs = ['x'];
    assert.equal(validateConfig(stray).ok, false);
  });

  it('offers kamikaze to enemies but never the boss', () => {
    const enemy = editable();
    enemy.maps.grid.characters.enemy2.attackType = 'kamikaze';
    assert.equal(validateConfig(enemy).ok, true);
    const boss = editable();
    boss.maps.grid.characters.boss.attackType = 'kamikaze';
    assert.equal(validateConfig(boss).ok, false);
  });

  it('rejects a smuggled sound file', () => {
    const config = editable();
    config.maps.grid.characters.player.sounds = { shoot: '../../etc/passwd' };
    assert.equal(validateConfig(config).ok, false);
  });
});

describe('wasteland', () => {
  it('generates the same buses and signs for the same seed', () => {
    const collect = (seed) => {
      const s = game({ map: 'wasteland', seed });
      const items = [];
      forEachItemIn(s.world, -3000, -3000, 3000, 3000, (item) => items.push([item.kind, item.x, item.y]));
      return items;
    };
    assert.deepEqual(collect(5), collect(5));
    assert.ok(collect(5).some(([kind]) => kind === 'bus'));
    assert.ok(collect(5).some(([kind]) => kind === 'sign'));
  });

  it('keeps buses away from the start', () => {
    const s = game({ map: 'wasteland' });
    forEachItemIn(s.world, -2000, -2000, 2000, 2000, (item) => {
      if (item.kind === 'bus') assert.ok(Math.hypot(item.x, item.y) > 760);
    });
  });

  it('puts a Rocketeer on a bus that never moves', () => {
    const { s, bus, crew } = crewedGame();
    assert.ok(crew);
    for (let i = 0; i < 120; i++) step(s, DT, still);
    assert.equal(crew.x, bus.x);
    assert.equal(crew.y, bus.y);
  });

  it('blocks walking into a bus', () => {
    const { s, bus } = crewedGame({ edit: (c) => { c.characters.rocketeer.enabled = false; } });
    s.player.x = bus.x;
    s.player.y = bus.y;
    step(s, DT, still);
    assert.ok(Math.hypot(s.player.x - bus.x, s.player.y - bus.y) > 10);
  });

  it('lets shots reach the Rocketeer over the bus', () => {
    const { s, crew } = crewedGame();
    const before = crew.hp;
    s.shots.push({ x: crew.x + 60, y: crew.y, vx: -680, vy: 0, ttl: 1, damage: 5, ally: false, pierce: 0 });
    for (let i = 0; i < 10; i++) step(s, DT, still);
    assert.ok(crew.hp < before);
  });

  it('launches guided rockets while on screen', () => {
    const { s } = crewedGame();
    s.player.cool = 9999; // otherwise the player kills it first
    for (let i = 0; i < 60 * 8 && !s.missiles.length; i++) step(s, DT, still);
    assert.equal(s.missiles[0]?.kind, 'rocket');
  });

  it('never returns a killed Rocketeer but restores one walked away from', () => {
    const { s, bus, crew } = crewedGame();
    crew.hp = 1;
    s.shots.push({ x: crew.x + 20, y: crew.y, vx: -680, vy: 0, ttl: 1, damage: 50, ally: false, pierce: 0 });
    step(s, DT, still);
    assert.equal(s.enemies.some((e) => e.busId === bus.id), false);
    step(s, DT, still);
    assert.equal(s.enemies.some((e) => e.busId === bus.id), false);

    const other = crewedGame({ seed: 2 });
    other.s.player.x = other.bus.x + 9000;
    step(other.s, DT, still);
    assert.equal(other.s.enemies.some((e) => e.busId === other.bus.id), false);
    other.s.player.x = other.bus.x + 230;
    step(other.s, DT, still);
    assert.equal(other.s.enemies.some((e) => e.busId === other.bus.id), true);
  });

  it('leaves buses empty when the Rocketeer is off', () => {
    const { crew } = crewedGame({ edit: (c) => { c.characters.rocketeer.enabled = false; } });
    assert.equal(crew, undefined);
  });

  it('allows for Rocketeer kills in the score limits', () => {
    const wasteland = mapConfig(defaultConfig(), 'wasteland');
    const grid = mapConfig(defaultConfig(), 'grid');
    assert.ok(scoreLimits(wasteland).minSpawnGap < scoreLimits(grid).minSpawnGap);
  });
});

describe('wasteland obstacles', () => {
  const collect = (seed, kind, range = 6000, edit) => {
    const s = game({ map: 'wasteland', seed, edit });
    const items = [];
    forEachItemIn(s.world, -range, -range, range, range, (item) => { if (item.kind === kind) items.push(item); });
    return { s, items };
  };

  it('stops a walker at a sign, but not a shot', () => {
    const { s, items } = collect(3, 'sign');
    const sign = items.find((item) => Math.hypot(item.x, item.y) > 600);
    s.player.x = sign.x;
    s.player.y = sign.y - 40;
    s.player.cool = 9999;
    for (let i = 0; i < 30; i++) step(s, DT, { x: 0, y: 1 });
    assert.ok(s.player.y < sign.y, 'walked through the board');
    assert.equal(hitsSolid(s.world, sign.x, sign.y), false);
  });

  it('blocks the whole width of a sign, not only its posts', () => {
    const { s, items } = collect(3, 'sign');
    const sign = items.find((item) => Math.hypot(item.x, item.y) > 600);
    for (const offset of [-40, -20, 0, 20, 40]) {
      s.player.x = sign.x + offset;
      s.player.y = sign.y - 34;
      s.player.cool = 9999;
      for (let i = 0; i < 20; i++) step(s, DT, { x: 0, y: 1 });
      assert.ok(s.player.y < sign.y, `passed at offset ${offset}`);
    }
  });

  it('stops walkers and shots at a hill', () => {
    const { s, items } = collect(3, 'hill');
    const lobe = items[0].lobes[0];
    assert.equal(hitsSolid(s.world, lobe.x, lobe.y), true);
    s.player.x = lobe.x;
    s.player.y = lobe.y - lobe.r - 40;
    s.player.cool = 9999;
    for (let i = 0; i < 40; i++) step(s, DT, { x: 0, y: 1 });
    assert.ok(Math.hypot(s.player.x - lobe.x, s.player.y - lobe.y) >= lobe.r);
  });

  it('has hills that shape the map without filling it', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { items } = collect(seed, 'hill', 4800);
      const share = items.length / 400; // the range covers 20 by 20 chunks
      assert.ok(share > 0.05 && share < 0.4, `seed ${seed}: ${share}`);
    }
  });

  it('builds hills from one to three lobes', () => {
    const { items } = collect(2, 'hill');
    assert.ok(items.every((hill) => hill.lobes.length >= 1 && hill.lobes.length <= 3));
    assert.ok(new Set(items.map((hill) => hill.lobes.length)).size > 1);
  });

  it('keeps every obstacle clear of the start and the boss arena', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = game({ map: 'wasteland', seed });
      const arena = s.cfg.gameplay.arenaRadius;
      forEachItemIn(s.world, -9000, -9000, 9000, 9000, (item) => {
        for (const part of item.lobes ?? [item]) {
          const r = part.r ?? 80;
          assert.ok(Math.hypot(part.x, part.y) >= 260 + r - 1, `${item.kind} at the start`);
          assert.ok(Math.hypot(part.x - s.hostage.x, part.y - s.hostage.y) >= arena + 60 + r - 1, `${item.kind} in the arena`);
        }
      });
    }
  });

  it('does not put a bus or a sign inside a hill', () => {
    const s = game({ map: 'wasteland', seed: 6 });
    const all = [];
    forEachItemIn(s.world, -9000, -9000, 9000, 9000, (item) => all.push(item));
    const hills = all.filter((item) => item.kind === 'hill');
    for (const item of all.filter((other) => other.kind !== 'hill')) {
      for (const lobe of hills.flatMap((hill) => hill.lobes)) assert.ok(Math.hypot(item.x - lobe.x, item.y - lobe.y) > lobe.r);
    }
  });

  it('always leaves room between neighbouring hills', () => {
    for (const seed of [1, 2, 3]) {
      const hills = collect(seed, 'hill', 9000).items;
      assert.ok(hills.length);
      for (const a of hills) {
        for (const b of hills) {
          if (a === b || Math.hypot(a.x - b.x, a.y - b.y) > 700) continue;
          for (const la of a.lobes) for (const lb of b.lobes) assert.ok(Math.hypot(la.x - lb.x, la.y - lb.y) - la.r - lb.r >= 28);
        }
      }
    }
  });

  it('follows the bus chance', () => {
    const edit = (value) => (c) => { c.gameplay.busChance = value; };
    assert.equal(collect(1, 'bus', 6000, edit(0)).items.length, 0);
    assert.ok(collect(1, 'bus', 6000, edit(0.9)).items.length > collect(1, 'bus', 6000, edit(0.1)).items.length);
  });
});

describe('spawn rates per map', () => {
  const editable = () => {
    const config = defaultConfig();
    for (const map of Object.values(config.maps)) for (const ch of Object.values(map.characters)) { delete ch.sprite; delete ch.sounds; }
    return config;
  };
  const rejected = (name, mutate) => it(`rejects ${name}`, () => {
    const config = editable();
    mutate(config);
    assert.equal(validateConfig(config).ok, false);
  });

  it('accepts a different rate on each map', () => {
    const config = editable();
    config.maps.grid.spawns.spawnInterval = 0.2;
    config.maps.forest.spawns.spawnInterval = 5;
    const { value } = validateConfig(config);
    assert.equal(mapConfig(value, 'grid').gameplay.spawnInterval, 0.2);
    assert.equal(mapConfig(value, 'forest').gameplay.spawnInterval, 5);
  });

  it('keeps the shared rules alongside', () => {
    assert.equal(mapConfig(defaultConfig(), 'grid').gameplay.hintSeconds, defaultConfig().gameplay.hintSeconds);
  });

  it('does not write spawn changes back to the shared config', () => {
    const config = defaultConfig();
    mapConfig(config, 'grid').gameplay.spawnInterval = 9;
    assert.notEqual(config.maps.grid.spawns.spawnInterval, 9);
  });

  it('really changes the pace of a game', () => {
    const count = (interval) => {
      const cfg = mapConfig(defaultConfig(), 'grid');
      cfg.gameplay.spawnInterval = interval;
      cfg.characters.player.damage = 0;
      const s = createGame(cfg, { rng: seeded(8) });
      for (let i = 0; i < 60 * 12; i++) { s.player.hp = s.player.maxHp; step(s, DT, still); }
      return s.enemies.length;
    };
    assert.ok(count(0.4) > count(4));
  });

  rejected('a chance over 1', (c) => { c.maps.forest.spawns.jetChance = 1.5; });
  rejected('a negative chance', (c) => { c.maps.grid.spawns.enemy1Chance = -0.1; });
  rejected('a zero spawn interval', (c) => { c.maps.grid.spawns.spawnInterval = 0; });
  rejected('a missing spawn panel', (c) => { delete c.maps.grid.spawns; });
  rejected('a bus chance on a map without buses', (c) => { c.maps.grid.spawns.busChance = 0.5; });
  rejected('spawn settings in the old shared place', (c) => { c.gameplay.spawnInterval = 1; });
});

describe('rocket interception', () => {
  const quiet = (edit) => game({ map: 'wasteland', edit: (c) => { c.characters.rocketeer.enabled = false; edit?.(c); } });

  it('is destroyed by a shot, without a kill', () => {
    const s = quiet();
    s.player.cool = 9999;
    const m = rocketAt(s, 200, 0);
    s.shots.push({ x: 196, y: 0, vx: 0, vy: 0, ttl: 1, damage: 1, ally: false, pierce: 0 });
    step(s, DT, still);
    assert.equal(s.missiles.includes(m), false);
    assert.equal(s.kills, 0);
    assert.equal(s.shots.length, 0);
  });

  it('is targeted by auto-fire and by companions', () => {
    const s = quiet();
    rocketAt(s, 200, 0);
    step(s, DT, still);
    assert.ok(s.shots.length && s.shots[0].vx > 0 && Math.abs(s.shots[0].vy) < 1);

    const ally = quiet();
    ally.player.cool = 9999;
    ally.companions.push({ x: 0, y: 40, vx: 0, vy: 0, hp: 80, maxHp: 80, r: 16, cool: 0, flash: 0, face: 1, down: 0 });
    rocketAt(ally, 300, 40);
    step(ally, DT, still);
    assert.ok(ally.shots.some((shot) => shot.ally && shot.vx > 0));
  });

  it('comes before a farther enemy', () => {
    const s = quiet();
    s.enemies.push({ x: -180, y: 0, vx: 0, vy: 0, hp: 50, maxHp: 50, r: 15, cool: 0, flash: 0, face: 1, kind: 'enemy2', size: 36, xp: 10, speed: 0, damage: 1, attack: 'melee' });
    rocketAt(s, 240, 0);
    step(s, DT, still);
    assert.ok(s.shots[0].vx > 0);
  });

  it('can still be clicked', () => {
    const s = quiet();
    rocketAt(s, 200, 0);
    assert.equal(destroyMissileAt(s, 200, 0, 20), true);
    assert.equal(s.missiles.length, 0);
  });

  it('leaves Kh-29 missiles to clicks only', () => {
    const s = game();
    s.missiles.push({ x: 200, y: 0, vx: 0, vy: 0, heading: 0, r: 18, damage: 40, ttl: 8 });
    step(s, DT, still);
    assert.equal(s.shots.length, 0);
    s.shots.push({ x: 200, y: 0, vx: 0, vy: 0, ttl: 1, damage: 1, ally: false, pierce: 0 });
    step(s, DT, still);
    assert.equal(s.missiles.length, 1);
  });
});

describe('endless mode', () => {
  const noBossAtStart = () => game({ mode: 'endless' });

  it('has no hostage and no guardian boss', () => {
    const s = noBossAtStart();
    assert.equal(s.hostage, null);
    assert.equal(s.boss.alive, false);
    for (let i = 0; i < 600; i++) step(s, DT, still);
    assert.equal(s.status, 'playing');
  });

  it('spawns forever and never lights a direction', () => {
    const s = createGame(mapConfig(defaultConfig(), 'grid'), { rng: seeded(4), mode: 'endless' });
    for (let i = 0; i < 60 * 30 && s.status === 'playing'; i++) {
      s.player.hp = s.player.maxHp;
      step(s, DT, still);
    }
    assert.ok(s.kills > 0);
    assert.equal(s.hint, null);
  });

  it('keeps the companion rule on kills alone', () => {
    const s = game({ mode: 'endless', edit: (c) => { c.gameplay.companionKills = 1; } });
    step(s, DT, still);
    assert.equal(s.companions.length, 0);
    s.kills = 1;
    step(s, DT, still);
    assert.equal(s.companions.length, 1);
  });

  const withBoss = () => {
    const cfg = mapConfig(defaultConfig(), 'grid');
    cfg.characters.jet.enabled = false; // this rng would always roll the jet first
    const s = createGame(cfg, { rng: () => 0.001, mode: 'endless' });
    s.time = 61;
    s.spawnT = 0;
    step(s, DT, still);
    return s;
  };

  it('spawns the boss as a regular enemy at the configured chance', () => {
    const s = withBoss();
    const boss = s.enemies.find((e) => e.kind === 'boss');
    assert.ok(boss);
    assert.equal(s.boss.alive, false);
    assert.ok(s.events.some((e) => e.type === 'bossSpawn'));
    assert.equal(boss.attack, s.cfg.characters.boss.attackType);
  });

  it('never spawns the boss early, or with chance zero, or two at once, or when it is off', () => {
    const early = createGame(mapConfig(defaultConfig(), 'grid'), { rng: () => 0.001, mode: 'endless' });
    early.spawnT = 0;
    step(early, DT, still);
    assert.equal(early.enemies.some((e) => e.kind === 'boss'), false);

    const none = createGame(mapConfig(defaultConfig(), 'grid'), { rng: () => 0.001, mode: 'endless' });
    none.cfg.gameplay.bossChance = 0;
    none.time = 61;
    none.spawnT = 0;
    step(none, DT, still);
    assert.equal(none.enemies.some((e) => e.kind === 'boss'), false);

    const twice = withBoss();
    twice.spawnT = 0;
    step(twice, DT, still);
    assert.equal(twice.enemies.filter((e) => e.kind === 'boss').length, 1);

    const off = mapConfig(defaultConfig(), 'grid');
    off.characters.boss.enabled = false;
    const disabled = createGame(off, { rng: () => 0.001, mode: 'endless' });
    disabled.time = 61;
    disabled.spawnT = 0;
    step(disabled, DT, still);
    assert.equal(disabled.enemies.some((e) => e.kind === 'boss'), false);
  });

  it('counts a boss kill like any other and keeps the game running', () => {
    const s = withBoss();
    const boss = s.enemies.find((e) => e.kind === 'boss');
    boss.hp = 1;
    s.events.length = 0;
    s.shots.push({ x: boss.x, y: boss.y, vx: 0, vy: 0, ttl: 1, damage: 50, ally: false, pierce: 0 });
    step(s, DT, still);
    assert.equal(s.kills, 1);
    assert.equal(s.status, 'playing');
    assert.equal(s.events.some((e) => e.type === 'bossDead'), false);
    assert.equal(s.orbs.at(-1).xp, s.cfg.characters.boss.endlessXp);
  });

  it('leaves rescue games as they were', () => {
    const s = game();
    assert.ok(s.hostage);
    assert.equal(s.boss.alive, true);
  });
});

describe('kamikaze', () => {
  const bomber = (s, x, y = 0) => {
    const e = { x, y, vx: 0, vy: 0, hp: 40, maxHp: 40, r: 15, cool: 0, flash: 0, face: 1, kind: 'enemy2', size: 36, xp: 10, speed: 200, damage: 25, attack: 'kamikaze' };
    s.enemies.push(e);
    return e;
  };

  it('dies on contact, hurts once, and gives no kill or XP', () => {
    const s = game();
    const e = bomber(s, 20);
    step(s, DT, still);
    assert.equal(s.player.hp, s.player.maxHp - 25);
    assert.equal(s.enemies.includes(e), false);
    assert.equal(s.kills, 0);
    assert.equal(s.orbs.length, 0);
    assert.ok(s.events.some((event) => event.type === 'kamikaze' && event.role === 'enemy2'));
  });

  it('does not fire and is not triggered at range', () => {
    const s = game();
    s.player.cool = 999;
    const e = bomber(s, 400);
    step(s, DT, still);
    assert.equal(s.enemies.includes(e), true);
    assert.equal(s.player.hp, s.player.maxHp);
    assert.equal(s.bullets.length, 0);
  });

  it('can slam into a companion instead', () => {
    const s = game();
    s.player.x = 5000;
    const m = { x: 0, y: 0, vx: 0, vy: 0, hp: 80, maxHp: 80, r: 16, cool: 0, flash: 0, face: 1, down: 0 };
    s.companions.push(m);
    const e = bomber(s, 20);
    s.enemies.length = 0;
    s.enemies.push(e);
    s.player.cool = 999;
    m.cool = 999;
    step(s, DT, still);
    assert.ok(m.hp < 80 || !s.enemies.includes(e));
  });

  it('counts as a kill when shot first', () => {
    const s = game();
    const e = bomber(s, 300);
    e.hp = 1;
    s.shots.push({ x: 300, y: 0, vx: 0, vy: 0, ttl: 1, damage: 50, ally: false, pierce: 0 });
    step(s, DT, still);
    assert.equal(s.kills, 1);
  });
});

describe('sound events', () => {
  it('reports who is shooting', () => {
    const s = game();
    s.enemies.push({ x: 150, y: 0, vx: 0, vy: 0, hp: 500, maxHp: 500, r: 15, cool: 99, flash: 0, face: 1, kind: 'enemy2', size: 36, xp: 10, speed: 0, damage: 1, attack: 'melee' });
    step(s, DT, still);
    assert.ok(s.events.some((e) => e.type === 'shot' && e.role === 'player'));
  });

  it('reports a melee hit as the attack', () => {
    const s = game();
    s.player.cool = 999;
    s.enemies.push({ x: 20, y: 0, vx: 0, vy: 0, hp: 500, maxHp: 500, r: 15, cool: 0, flash: 0, face: 1, kind: 'enemy1', size: 62, xp: 10, speed: 0, damage: 1, attack: 'melee' });
    step(s, DT, still);
    assert.ok(s.events.some((e) => e.type === 'shot' && e.role === 'enemy1'));
  });

  it('reports one event for a whole pump volley', () => {
    const s = game();
    s.player.cool = 999;
    const e = { x: 150, y: 0, vx: 0, vy: 0, hp: 500, maxHp: 500, r: 15, cool: 99, flash: 0, face: 1, kind: 'enemy1', size: 62, xp: 10, speed: 0, damage: 1, attack: 'pump', windup: DT / 2, aim: Math.PI };
    s.enemies.push(e);
    step(s, DT, still);
    assert.equal(s.events.filter((event) => event.type === 'shot' && event.role === 'enemy1').length, 1);
    assert.equal(s.bullets.length, 5);
  });
});
