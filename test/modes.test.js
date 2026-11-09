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
          const r = part.r ?? (item.kind === 'sign' ? 80 : 24);
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

  const count = (map, seed, kind) => {
    const s = game({ map, seed });
    let n = 0;
    forEachItemIn(s.world, -7000, -7000, 7000, 7000, (item) => { if (item.kind === kind) n += 1; });
    return n;
  };

  it('has about as many trees as the forest map', () => {
    for (const seed of [1, 2, 3, 4]) {
      const ratio = count('wasteland', seed, 'brownTree') / count('forest', seed, 'tree');
      assert.ok(ratio > 0.7 && ratio <= 1.05, `seed ${seed}: ${ratio}`);
    }
  });

  it('gives the forest no brown trees', () => assert.equal(count('forest', 1, 'brownTree'), 0));

  it('stops walkers and shots at a tree', () => {
    const { s, items } = collect(1, 'brownTree');
    const tree = items.find((item) => Math.hypot(item.x, item.y) > 500);
    assert.equal(hitsSolid(s.world, tree.x, tree.y), true);
    s.player.x = tree.x;
    s.player.y = tree.y - 70;
    s.player.cool = 9999;
    for (let i = 0; i < 24; i++) {
      step(s, DT, { x: 0, y: 1 });
      assert.ok(Math.hypot(s.player.x - tree.x, s.player.y - tree.y) >= 24);
    }
  });

  it('keeps trees off buses, signs and hills', () => {
    const s = game({ map: 'wasteland', seed: 5 });
    const all = [];
    forEachItemIn(s.world, -7000, -7000, 7000, 7000, (item) => all.push(item));
    const trees = all.filter((item) => item.kind === 'brownTree');
    assert.ok(trees.length);
    for (const tree of trees) {
      for (const other of all) {
        const near = Math.hypot(tree.x - other.x, tree.y - other.y);
        if (other.kind === 'bus') assert.ok(near >= 150);
        if (other.kind === 'sign') assert.ok(near >= 130);
        for (const lobe of other.lobes ?? []) assert.ok(Math.hypot(tree.x - lobe.x, tree.y - lobe.y) >= lobe.r + 24);
      }
    }
  });

  it('follows the bus chance', () => {
    const edit = (value) => (c) => { c.characters.rocketeer.spawnChance = value; };
    assert.equal(collect(1, 'bus', 6000, edit(0)).items.length, 0);
    assert.ok(collect(1, 'bus', 6000, edit(0.9)).items.length > collect(1, 'bus', 6000, edit(0.1)).items.length);
  });
});

describe('first spawn and most at once', () => {
  const run = (edit, seconds, map = 'grid', mode = 'endless') => {
    const cfg = mapConfig(defaultConfig(), map);
    Object.assign(cfg.gameplay, { spawnInterval: 0.1, maxEnemies: 1e6 });
    cfg.characters.jet.enabled = false;
    edit(cfg.characters);
    const s = createGame(cfg, { rng: seeded(13), mode });
    s.player.hp = s.player.maxHp = 1e15;
    s.player.cool = 1e12;
    const firstSeen = {};
    let most = {};
    for (let i = 0; i < 60 * seconds; i++) {
      step(s, DT, still);
      s.player.hp = s.player.maxHp;
      s.bullets.length = 0;
      s.missiles.length = 0;
      const now = {};
      for (const e of s.enemies) {
        now[e.kind] = (now[e.kind] ?? 0) + 1;
        firstSeen[e.kind] ??= s.time;
      }
      for (const [kind, n] of Object.entries(now)) most[kind] = Math.max(most[kind] ?? 0, n);
    }
    return { firstSeen, most };
  };

  it('keeps today\'s limits as the defaults', () => {
    const { characters: c } = defaultConfig().maps.grid;
    assert.equal(c.enemy5.firstSpawn, 40);
    assert.equal(c.jet.firstSpawn, 60);
    assert.equal(c.jet.maxAlive, 1);
    for (const role of ['enemy1', 'enemy2', 'boss']) {
      assert.equal(c[role].firstSpawn, 0);
      assert.equal(c[role].maxAlive, 0);
    }
  });

  for (const kind of ['enemy1', 'enemy2', 'enemy5', 'boss']) {
    it(`holds ${kind} back until its first spawn time`, () => {
      const { firstSeen } = run((c) => {
        for (const other of ['enemy1', 'enemy2', 'enemy5', 'boss']) { c[other].spawnChance = 0.1; c[other].firstSpawn = 0; }
        c[kind].firstSpawn = 5;
      }, 12);
      assert.ok(firstSeen[kind] >= 5, JSON.stringify(firstSeen));
      assert.ok(firstSeen[kind] < 9, JSON.stringify(firstSeen));
    });

    it(`never has more ${kind} than its limit`, () => {
      const { most } = run((c) => {
        for (const other of ['enemy1', 'enemy2', 'enemy5', 'boss']) { c[other].spawnChance = 0.1; c[other].firstSpawn = 0; }
        c[kind].maxAlive = 2;
      }, 12);
      assert.equal(most[kind], 2);
    });
  }

  it('treats zero as no limit', () => {
    const { most } = run((c) => { c.enemy2.maxAlive = 0; c.enemy2.spawnChance = 1; c.enemy1.spawnChance = 0; c.enemy5.spawnChance = 0; c.boss.spawnChance = 0; }, 8);
    assert.ok(most.enemy2 > 20);
  });

  it('keeps spawning the others once one has reached its limit', () => {
    const { most } = run((c) => { c.enemy1.maxAlive = 1; c.enemy1.spawnChance = 0.9; c.enemy2.spawnChance = 0.1; c.enemy5.spawnChance = 0; c.boss.spawnChance = 0; }, 8);
    assert.equal(most.enemy1, 1);
    assert.ok(most.enemy2 > 10);
  });

  it('applies to the Su-34 too', () => {
    const cfg = mapConfig(defaultConfig(), 'grid');
    Object.assign(cfg.gameplay, { spawnInterval: 0.1, maxEnemies: 1e6 });
    Object.assign(cfg.characters.jet, { firstSpawn: 2, maxAlive: 2, spawnChance: 1 });
    for (const kind of ['enemy1', 'enemy2', 'enemy5']) cfg.characters[kind].spawnChance = 0;
    const s = createGame(cfg, { rng: seeded(4) });
    s.player.hp = s.player.maxHp = 1e15;
    let most = 0;
    let first = null;
    for (let i = 0; i < 60 * 6; i++) {
      step(s, DT, still);
      s.player.hp = s.player.maxHp;
      s.missiles.length = 0;
      const n = s.enemies.filter((e) => e.kind === 'jet').length;
      if (n && first === null) first = s.time;
      most = Math.max(most, n);
    }
    assert.ok(first >= 2);
    assert.equal(most, 2);
  });

  const onBuses = (edit) => {
    const cfg = mapConfig(defaultConfig(), 'wasteland');
    cfg.characters.rocketeer.spawnChance = 1;
    edit(cfg.characters.rocketeer);
    const s = createGame(cfg, { rng: seeded(6), view: { halfW: 1000, halfH: 1000 } });
    s.spawnT = 1e9;
    s.player.hp = s.player.maxHp = 1e15;
    s.player.cool = 1e12;
    return s;
  };
  const crew = (s) => s.enemies.filter((e) => e.kind === 'rocketeer').length;

  it('keeps buses empty until the Rocketeer\'s time', () => {
    const s = onBuses((c) => { c.firstSpawn = 2; });
    for (let i = 0; i < 60; i++) step(s, DT, still);
    assert.equal(crew(s), 0);
    for (let i = 0; i < 90; i++) step(s, DT, still);
    assert.ok(crew(s) > 0);
  });

  it('limits Rocketeers, and mans another bus after a kill', () => {
    const s = onBuses((c) => { c.maxAlive = 2; });
    step(s, DT, still);
    assert.equal(crew(s), 2);
    s.enemies.splice(s.enemies.findIndex((e) => e.kind === 'rocketeer'), 1);
    step(s, DT, still);
    assert.equal(crew(s), 2);
  });

  const editable = () => {
    const config = defaultConfig();
    for (const map of Object.values(config.maps)) for (const ch of Object.values(map.characters)) { delete ch.sprite; delete ch.sounds; }
    return config;
  };
  for (const [name, mutate] of [
    ['a negative first spawn', (c) => { c.maps.grid.characters.enemy1.firstSpawn = -1; }],
    ['a negative limit', (c) => { c.maps.grid.characters.enemy2.maxAlive = -1; }],
    ['a first spawn on the player', (c) => { c.maps.grid.characters.player.firstSpawn = 1; }],
    ['a limit on the hostage', (c) => { c.maps.grid.characters.hostage.maxAlive = 1; }],
  ]) {
    it(`rejects ${name}`, () => {
      const config = editable();
      mutate(config);
      assert.equal(validateConfig(config).ok, false);
    });
  }
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

  const mix = (edit, seconds = 400) => {
    const cfg = mapConfig(defaultConfig(), 'grid');
    cfg.characters.jet.enabled = false;
    cfg.gameplay.maxEnemies = 1e6;
    cfg.gameplay.spawnInterval = 0.1;
    cfg.characters.player.damage = 0;
    edit(cfg.characters);
    const s = createGame(cfg, { rng: seeded(11) });
    s.time = 100;
    s.player.hp = s.player.maxHp = 1e12;
    s.player.cool = 1e9;
    const counts = {};
    for (let i = 0; i < 60 * seconds; i++) {
      step(s, DT, still);
      for (const e of s.enemies) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      s.enemies.length = 0;
    }
    return counts;
  };

  it('shares spawns in proportion to each character\'s chance', () => {
    const counts = mix((c) => { c.enemy1.spawnChance = 0.3; c.enemy2.spawnChance = 0.6; c.enemy5.spawnChance = 0.1; });
    const total = counts.enemy1 + counts.enemy2 + counts.enemy5;
    assert.ok(Math.abs(counts.enemy1 / total - 0.3) < 0.05, JSON.stringify(counts));
    assert.ok(Math.abs(counts.enemy2 / total - 0.6) < 0.05, JSON.stringify(counts));
    assert.ok(Math.abs(counts.enemy5 / total - 0.1) < 0.05, JSON.stringify(counts));
  });

  it('never spawns a character whose chance is zero', () => {
    const counts = mix((c) => { c.enemy2.spawnChance = 0; c.enemy1.spawnChance = 0.4; });
    assert.equal(counts.enemy2, undefined);
    assert.ok(counts.enemy1 > 0);
  });

  it('keeps spawning when the chances add up to less or more than 1', () => {
    const low = mix((c) => { c.enemy1.spawnChance = 0.05; c.enemy2.spawnChance = 0.05; c.enemy5.spawnChance = 0; });
    const high = mix((c) => { c.enemy1.spawnChance = 1; c.enemy2.spawnChance = 1; c.enemy5.spawnChance = 1; });
    const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum(low) - sum(high)) / sum(high) < 0.05);
  });

  it('gives a switched-off enemy\'s share to the others', () => {
    const counts = mix((c) => { c.enemy2.enabled = false; });
    assert.equal(counts.enemy2, undefined);
    assert.ok(counts.enemy1 > counts.enemy5);
  });

  it('spawns nothing when no enabled enemy has a chance', () => {
    const counts = mix((c) => { c.enemy1.spawnChance = 0; c.enemy2.spawnChance = 0; c.enemy5.spawnChance = 0; });
    assert.deepEqual(counts, {});
  });

  it('uses the Rocketeer\'s chance for buses', () => {
    const buses = (value) => {
      const cfg = mapConfig(defaultConfig(), 'wasteland');
      cfg.characters.rocketeer.spawnChance = value;
      const s = createGame(cfg, { rng: seeded(2) });
      let n = 0;
      forEachItemIn(s.world, -6000, -6000, 6000, 6000, (item) => { if (item.kind === 'bus') n += 1; });
      return n;
    };
    assert.equal(buses(0), 0);
    assert.ok(buses(0.8) > buses(0.1));
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

  rejected('a chance over 1', (c) => { c.maps.forest.characters.jet.spawnChance = 1.5; });
  rejected('a negative chance', (c) => { c.maps.grid.characters.enemy1.spawnChance = -0.1; });
  rejected('a zero spawn interval', (c) => { c.maps.grid.spawns.spawnInterval = 0; });
  rejected('a missing spawn panel', (c) => { delete c.maps.grid.spawns; });
  rejected('a chance on a character that does not spawn', (c) => { c.maps.grid.characters.player.spawnChance = 0.5; });
  rejected('a chance left in the per-map panel', (c) => { c.maps.grid.spawns.jetChance = 0.5; });
  rejected('no regular enemy with any chance of spawning', (c) => { for (const role of ['enemy1', 'enemy2', 'enemy5']) c.maps.grid.characters[role].spawnChance = 0; });
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
    ally.companions.push({ x: 0, y: 40, vx: 0, vy: 0, hp: 80, maxHp: 80, r: 16, cool: 0, flash: 0, face: 1, down: 0, role: 'companion' });
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

const onlyBoss = (cfg) => {
  cfg.characters.boss.spawnChance = 1;
  for (const kind of ['enemy1', 'enemy2', 'enemy5', 'jet']) cfg.characters[kind].spawnChance = 0;
};

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
    onlyBoss(cfg);
    const s = createGame(cfg, { rng: seeded(5), mode: 'endless' });
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

  it('can spawn from the first moment, and several at once', () => {
    const s = withBoss();
    assert.equal(s.enemies.filter((e) => e.kind === 'boss').length, 1);
    assert.ok(s.time < 1);
    s.spawnT = 0;
    step(s, DT, still);
    assert.equal(s.enemies.filter((e) => e.kind === 'boss').length, 2);
  });

  const noBoss = (edit, mode = 'endless') => {
    const cfg = mapConfig(defaultConfig(), 'grid');
    onlyBoss(cfg);
    cfg.characters.enemy2.spawnChance = 1;
    edit(cfg);
    const s = createGame(cfg, { rng: seeded(5), mode });
    s.spawnT = 0;
    for (let i = 0; i < 20; i++) { s.spawnT = 0; step(s, DT, still); }
    return s.enemies.some((e) => e.kind === 'boss');
  };

  it('never spawns the boss with a rate of zero or when it is off', () => {
    assert.equal(noBoss((cfg) => { cfg.characters.boss.spawnChance = 0; }), false);
    assert.equal(noBoss((cfg) => { cfg.characters.boss.enabled = false; }), false);
    assert.equal(noBoss(() => {}), true);
  });

  it('never spawns an extra boss in Rescue, whatever its rate', () => {
    const cfg = mapConfig(defaultConfig(), 'grid');
    cfg.characters.boss.spawnChance = 1;
    const s = createGame(cfg, { rng: seeded(5) });
    for (let i = 0; i < 40; i++) { s.spawnT = 0; step(s, DT, still); }
    assert.equal(s.enemies.some((e) => e.kind === 'boss'), false);
  });

  it('holds the boss to its rate against other characters', () => {
    const cfg = mapConfig(defaultConfig(), 'grid');
    Object.assign(cfg.gameplay, { spawnInterval: 0.1, maxEnemies: 1e6 });
    cfg.characters.boss.spawnChance = 0.15;
    cfg.characters.enemy1.spawnChance = 0.3;
    cfg.characters.enemy2.spawnChance = 0.5;
    cfg.characters.enemy5.spawnChance = 0;
    cfg.characters.jet.enabled = false;
    const s = createGame(cfg, { rng: seeded(21), mode: 'endless' });
    s.player.hp = s.player.maxHp = 1e15;
    s.player.cool = 1e12;
    const counts = {};
    for (let i = 0; i < 60 * 500; i++) {
      step(s, DT, still);
      for (const e of s.enemies) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      s.enemies.length = 0;
    }
    const ratio = counts.enemy1 / counts.boss;
    assert.ok(ratio > 1.7 && ratio < 2.3, JSON.stringify(counts));
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

describe('boss attack', () => {
  const fighter = (edit) => {
    const cfg = mapConfig(defaultConfig(), 'grid');
    Object.assign(cfg.characters.enemy2, { attackType: 'boss', speed: 100, hp: 5000, damage: 10 });
    cfg.characters.enemy1.spawnChance = 0;
    cfg.characters.enemy5.spawnChance = 0;
    cfg.characters.jet.enabled = false;
    edit?.(cfg);
    const s = createGame(cfg, { rng: seeded(3) });
    s.player.hp = s.player.maxHp = 1e9;
    s.player.cool = 1e12;
    s.spawnT = 0;
    step(s, DT, still);
    s.spawnT = 1e9;
    const e = s.enemies[0];
    e.x = 200;
    e.y = 0;
    s.bullets.length = 0;
    return { s, e };
  };

  it('is offered to enemies and the boss, and validated', () => {
    const config = defaultConfig();
    for (const map of Object.values(config.maps)) for (const ch of Object.values(map.characters)) { delete ch.sprite; delete ch.sounds; }
    config.maps.grid.characters.enemy1.attackType = 'boss';
    config.maps.grid.characters.boss.attackType = 'boss';
    assert.equal(validateConfig(config).ok, true);
  });

  it('fires a fan of five, then a ring of sixteen', () => {
    const { s, e } = fighter();
    const keepAway = () => { s.player.x = e.x - 300; s.player.y = e.y; };
    let most = 0;
    let fan = false;
    for (let i = 0; i < 60 * 1.3; i++) {
      keepAway();
      step(s, DT, still);
      fan = fan || s.bullets.length === 5;
    }
    assert.ok(fan, 'no fan');
    s.bullets.length = 0;
    for (let i = 0; i < 60 * 3; i++) {
      keepAway();
      step(s, DT, still);
      most = Math.max(most, s.bullets.length);
    }
    assert.ok(most >= 16, `at most ${most} bullets`);
  });

  it('winds up and charges at several times its speed', () => {
    const { s, e } = fighter();
    let top = 0;
    let wound = false;
    for (let i = 0; i < 60 * 6.5; i++) {
      step(s, DT, still);
      wound = wound || e.windup > 0;
      top = Math.max(top, Math.hypot(e.vx, e.vy));
      s.bullets.length = 0;
      s.player.x = e.x - 400;
      s.player.y = e.y;
    }
    assert.ok(wound);
    assert.ok(top > e.speed * 4, `top speed ${top}`);
  });

  it('speeds up its attacks when badly hurt', () => {
    const shots = (health) => {
      const { s, e } = fighter();
      e.hp = e.maxHp * health;
      let volleys = 0;
      for (let i = 0; i < 60 * 12; i++) {
        s.events.length = 0;
        step(s, DT, still);
        volleys += s.events.filter((event) => event.type === 'shot' && event.role === 'enemy2').length;
        s.bullets.length = 0;
        s.player.x = e.x - 300;
        s.player.y = e.y;
      }
      return volleys;
    };
    assert.ok(shots(0.3) > shots(1));
  });

  it('hits harder on contact than its bullets', () => {
    const { s, e } = fighter();
    s.grace = 0;
    e.x = 10;
    const before = s.player.hp;
    step(s, DT, still);
    assert.equal(before - s.player.hp, e.damage * 1.6);
  });

  it('holds its fire off screen', () => {
    const { s, e } = fighter();
    for (let i = 0; i < 60 * 3; i++) {
      e.x = 5000;
      e.y = 0;
      step(s, DT, still);
    }
    assert.equal(s.bullets.length, 0);
  });

  it('can be killed like any enemy and gives its XP', () => {
    const { s, e } = fighter();
    e.hp = 1;
    s.shots.push({ x: e.x, y: e.y, vx: 0, vy: 0, ttl: 1, damage: 50, ally: false, pierce: 0 });
    step(s, DT, still);
    assert.equal(s.kills, 1);
    assert.equal(s.enemies.includes(e), false);
    assert.equal(s.status, 'playing');
  });

  it('stops at hills instead of walking through them', () => {
    const cfg = mapConfig(defaultConfig(), 'wasteland');
    const s = createGame(cfg, { rng: seeded(3) });
    let lobe = null;
    forEachItemIn(s.world, -6000, -6000, 6000, 6000, (item) => { if (item.kind === 'hill') lobe ??= item.lobes[0]; });
    s.player.x = lobe.x + lobe.r + 80;
    s.player.y = lobe.y;
    s.player.cool = 1e12;
    s.player.hp = s.player.maxHp = 1e9;
    s.spawnT = 1e9;
    const e = { x: lobe.x - lobe.r - 30, y: lobe.y, vx: 0, vy: 0, hp: 5000, maxHp: 5000, r: 15, cool: 0, flash: 0, face: 1, kind: 'enemy2', size: 36, xp: 10, speed: 200, damage: 1, attack: 'boss', fanT: 99, ringT: 99, chargeT: 99, windup: 0, dash: 0, dashX: 0, dashY: 0 };
    s.enemies.push(e);
    for (let i = 0; i < 30; i++) {
      step(s, DT, still);
      assert.ok(Math.hypot(e.x - lobe.x, e.y - lobe.y) >= lobe.r, 'inside the hill');
    }
  });

  it('makes the Endless boss fight like the guardian', () => {
    const cfg = mapConfig(defaultConfig(), 'grid');
    cfg.characters.boss.attackType = 'boss';
    cfg.characters.jet.enabled = false;
    onlyBoss(cfg);
    const s = createGame(cfg, { rng: seeded(5), mode: 'endless' });
    s.spawnT = 0;
    step(s, DT, still);
    const boss = s.enemies.find((e) => e.kind === 'boss');
    assert.equal(boss.attack, 'boss');
    assert.equal(boss.fanT > 0, true);
    assert.equal(s.boss.alive, false);
  });

  it('leaves the rescue boss the same whether set to Boss attack or Pump', () => {
    const run = (attackType) => {
      const cfg = mapConfig(defaultConfig(), 'grid');
      cfg.characters.boss.attackType = attackType;
      const s = createGame(cfg, { rng: seeded(9) });
      s.spawnT = 1e9;
      s.player.x = s.boss.x;
      s.player.y = s.boss.y + 300;
      s.player.hp = s.player.maxHp = 1e9;
      s.player.cool = 1e12;
      for (let i = 0; i < 60 * 9; i++) step(s, DT, still);
      return { x: s.boss.x, y: s.boss.y, bullets: s.bullets.length };
    };
    assert.deepEqual(run('boss'), run('pump'));
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
    const m = { x: 0, y: 0, vx: 0, vy: 0, hp: 80, maxHp: 80, r: 16, cool: 0, flash: 0, face: 1, down: 0, role: 'companion' };
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
