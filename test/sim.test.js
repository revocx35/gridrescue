import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, mapConfig } from '../public/js/schema.js';
import { forEachItemIn, hitsSolid } from '../public/js/scenery.js';
import { SHOP_SECTIONS, applyUpgrade, availableUpgrades, createGame, destroyMissileAt, scoreLimits, shopSections, step } from '../public/js/sim.js';

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

function game(seed = 1, edit = () => {}, mapId = 'grid') {
  const cfg = mapConfig(defaultConfig(), mapId);
  edit(cfg);
  return createGame(cfg, { rng: seeded(seed) });
}

const still = { x: 0, y: 0 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function placeEnemy(s, kind, x, y) {
  const ch = s.cfg.characters[kind];
  const e = { x, y, vx: 0, vy: 0, hp: ch.hp, maxHp: ch.hp, r: ch.size * 0.42, cool: 0, flash: 0, face: 1, kind, size: ch.size, xp: ch.xp, speed: ch.speed, damage: ch.damage };
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
    assert.equal(s.companions.length, 0);
    s.kills = 2;
    step(s, DT, still);
    assert.ok(s.companions[0]);
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
    assert.ok(s.companions[0]);
  });

  it('follows the player', () => {
    const s = game(4, (c) => { c.gameplay.companionKills = 0; });
    s.spawnT = 1e9;
    for (let i = 0; i < 60 * 4; i++) step(s, DT, { x: 1, y: 0 });
    assert.ok(dist(s.companions[0], s.player) < 260);
  });

  it('fights: it destroys an enemy on its own', () => {
    const s = game(4, (c) => { c.gameplay.companionKills = 0; c.characters.player.damage = 0; });
    s.spawnT = 1e9;
    step(s, DT, still);
    const e = placeEnemy(s, 'enemy2', s.companions[0].x + 200, s.companions[0].y);
    e.speed = 0;
    for (let i = 0; i < 60 * 6 && s.enemies.length; i++) step(s, DT, still);
    assert.equal(s.enemies.length, 0);
    assert.equal(s.kills, 1);
  });

  it('comes back after being downed', () => {
    const s = game(4, (c) => { c.gameplay.companionKills = 0; });
    s.spawnT = 1e9;
    step(s, DT, still);
    s.companions[0].hp = 1;
    placeEnemy(s, 'enemy2', s.companions[0].x, s.companions[0].y).speed = 0;
    s.enemies[0].hp = 1e9;
    s.player.x = s.companions[0].x + 300;
    s.cfg.characters.player.damage = 0;
    for (let i = 0; i < 30 && !s.companions[0].down; i++) step(s, DT, still);
    assert.ok(s.companions[0].down > 0);
    s.enemies.length = 0;
    for (let i = 0; i < 60 * 10; i++) step(s, DT, still);
    assert.equal(s.companions[0].down, 0);
    assert.equal(s.companions[0].hp, s.companions[0].maxHp);
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

describe('aiming', () => {
  it('fires where the aim stick points, even with no enemy in range', () => {
    const s = game();
    s.spawnT = 1e9;
    step(s, DT, { x: 0, y: 0, aimX: 0, aimY: -0.3 });
    assert.equal(s.shots.length, 1);
    assert.ok(Math.abs(s.shots[0].vx) < 1e-9);
    assert.ok(s.shots[0].vy < 0);
  });

  it('overrides auto-aim while held', () => {
    const s = game();
    s.spawnT = 1e9;
    placeEnemy(s, 'enemy2', 200, 0).speed = 0;
    step(s, DT, { x: 0, y: 0, aimX: -1, aimY: 0 });
    assert.ok(s.shots[0].vx < 0);
  });

  it('returns to auto-aim when released', () => {
    const s = game();
    s.spawnT = 1e9;
    placeEnemy(s, 'enemy2', 200, 0).speed = 0;
    step(s, DT, { x: 0, y: 0, aimX: 0, aimY: 0 });
    assert.equal(s.player.aim, null);
    assert.ok(s.shots[0].vx > 0);
  });

  it('respects the fire interval', () => {
    const s = game();
    s.spawnT = 1e9;
    for (let i = 0; i < 60; i++) step(s, DT, { x: 0, y: 0, aimX: 1, aimY: 0 });
    const expected = Math.floor(1 / s.cfg.characters.player.fireInterval) + 1;
    assert.ok(Math.abs(s.shots.length + 0 - expected) <= 1, String(s.shots.length));
  });
});

describe('enemy attack types', () => {
  function armed(attack, x = 200) {
    const s = game();
    s.spawnT = 1e9;
    s.cfg.characters.player.damage = 0;
    const e = placeEnemy(s, 'enemy2', x, 0);
    e.attack = attack;
    e.hp = e.maxHp = 1e9;
    return { s, e };
  }
  const until = (s, test, frames = 240) => {
    for (let i = 0; i < frames && !test(); i++) step(s, DT, still);
  };

  it('sniper fires exactly one bullet', () => {
    const { s } = armed('sniper', 340);
    until(s, () => s.bullets.length > 0);
    assert.equal(s.bullets.length, 1);
  });

  it('sniper telegraphs, then fires along the locked line so it can be dodged', () => {
    const { s, e } = armed('sniper', 340);
    until(s, () => e.windup > 0);
    const locked = e.aim;
    s.player.y = 300;
    until(s, () => s.bullets.length > 0);
    assert.ok(Math.abs(Math.atan2(s.bullets[0].vy, s.bullets[0].vx) - locked) < 1e-9);
  });

  it('pump fires a spread of pellets', () => {
    const { s } = armed('pump', 200);
    until(s, () => s.bullets.length > 0);
    assert.equal(s.bullets.length, 5);
    assert.ok(new Set(s.bullets.map((b) => b.vy.toFixed(3))).size === 5);
  });

  it('pump has to get close', () => {
    const { s, e } = armed('pump', 330);
    for (let i = 0; i < 12; i++) step(s, DT, still);
    assert.equal(s.bullets.length, 0);
    assert.ok(e.x < 330);
  });

  it('ranged enemies do not hit on contact', () => {
    const { s } = armed('sniper', 5);
    step(s, DT, still);
    assert.equal(s.player.hp, s.player.maxHp);
  });

  it('melee never shoots but hits on contact', () => {
    const { s } = armed('melee', 5);
    for (let i = 0; i < 60 * 5; i++) {
      step(s, DT, still);
      s.player.hp = Math.max(s.player.hp, 1);
    }
    assert.equal(s.bullets.length, 0);
    assert.ok(s.player.hp < s.player.maxHp);
  });

  it('does not shoot from outside the player\'s view', () => {
    const { s, e } = armed('sniper', 0);
    e.speed = 0;
    e.x = s.view.halfW + 40;
    for (let i = 0; i < 60 * 4; i++) step(s, DT, still);
    assert.equal(s.bullets.length, 0);
  });

  it('spawned enemies use the attack type set by the admin', () => {
    const s = game(3, (c) => { c.characters.enemy2.attackType = 'sniper'; c.characters.enemy1.spawnChance = 0; c.characters.enemy5.spawnChance = 0; c.characters.jet.spawnChance = 0; });
    s.spawnT = 0;
    step(s, DT, still);
    assert.equal(s.enemies[0].attack, 'sniper');
  });

  function bossFight(attack) {
    const s = game(9, (c) => { c.characters.boss.attackType = attack; c.characters.player.damage = 0; });
    s.spawnT = 1e9;
    s.player.hp = s.player.maxHp = 1e9;
    s.player.x = s.hostage.x + 480;
    s.player.y = s.hostage.y;
    return s;
  }

  it('boss with melee fires nothing', () => {
    const s = bossFight('melee');
    for (let i = 0; i < 60 * 12; i++) {
      step(s, DT, still);
      assert.equal(s.bullets.length, 0);
    }
  });

  it('boss with sniper fires single bullets', () => {
    const s = bossFight('sniper');
    until(s, () => s.bullets.length > 0, 60 * 5);
    assert.equal(s.bullets.length, 1);
  });

  it('boss with pump fires a spread', () => {
    const s = bossFight('pump');
    until(s, () => s.bullets.length > 0, 60 * 5);
    assert.equal(s.bullets.length, 5);
  });
});

describe('XP and upgrades', () => {
  function quiet(edit) {
    const s = game(1, edit);
    s.spawnT = 1e9;
    return s;
  }
  const levelUp = (s) => {
    s.upgradePoints += 1;
  };
  const giveOrb = (s, xp) => s.orbs.push({ x: s.player.x, y: s.player.y, xp });

  it('drops the configured XP where an enemy dies', () => {
    const s = quiet();
    placeEnemy(s, 'enemy1', 300, 0).hp = 1;
    placeEnemy(s, 'enemy2', -300, 0).hp = 1;
    s.enemies.forEach((e) => { e.speed = 0; });
    for (let i = 0; i < 60 && s.enemies.length; i++) step(s, DT, still);
    assert.deepEqual(s.orbs.map((o) => o.xp).sort((a, b) => a - b), [10, 40]);
  });

  it('pays more XP for stronger enemies on every map, with 200 per upgrade', () => {
    const { maps, gameplay } = defaultConfig();
    for (const { characters: c } of Object.values(maps)) {
      assert.ok(c.enemy5.xp > c.enemy1.xp && c.enemy1.xp > c.enemy2.xp);
      assert.equal(c.enemy1.xp, 40);
      assert.equal(c.enemy2.xp, 10);
    }
    assert.equal(gameplay.xpToUpgrade, 200);
  });

  it('drops nothing when XP is set to zero', () => {
    const s = quiet((c) => { c.characters.enemy2.xp = 0; });
    const e = placeEnemy(s, 'enemy2', 120, 0);
    e.hp = 1;
    e.speed = 0;
    for (let i = 0; i < 60 && s.enemies.length; i++) step(s, DT, still);
    assert.equal(s.orbs.length, 0);
  });

  it('collects an orb on touch', () => {
    const s = quiet();
    giveOrb(s, 40);
    step(s, DT, still);
    assert.equal(s.xp, 40);
    assert.equal(s.orbs.length, 0);
  });

  it('pulls in nearby orbs and leaves distant ones', () => {
    const s = quiet();
    s.orbs.push({ x: 120, y: 0, xp: 10 }, { x: 800, y: 0, xp: 10 });
    for (let i = 0; i < 60; i++) step(s, DT, still);
    assert.equal(s.xp, 10);
    assert.equal(s.orbs.length, 1);
  });

  it('does not pay out XP for an orb the player ran away from', () => {
    const s = quiet();
    s.orbs.push({ x: 4000, y: 0, xp: 10 });
    step(s, DT, still);
    assert.equal(s.orbs.length, 0);
    assert.equal(s.xp, 0);
  });

  it('banks a point at the threshold and keeps playing', () => {
    const s = quiet();
    giveOrb(s, 200);
    step(s, DT, still);
    assert.equal(s.status, 'playing');
    assert.equal(s.upgradePoints, 1);
    assert.ok(s.events.some((e) => e.type === 'upgradeReady'));
    const { time } = s;
    step(s, DT, { x: 1, y: 0 });
    assert.ok(s.time > time);
    assert.ok(s.player.x > 0);
  });

  it('does not bank a point below the threshold', () => {
    const s = quiet();
    giveOrb(s, 199);
    step(s, DT, still);
    assert.equal(s.upgradePoints, 0);
    assert.equal(s.events.some((e) => e.type === 'upgradeReady'), false);
  });

  it('keeps leftover XP and spends one point per upgrade', () => {
    const s = quiet();
    giveOrb(s, 230);
    step(s, DT, still);
    assert.equal(s.xp, 30);
    assert.equal(applyUpgrade(s, 'damage'), true);
    assert.equal(s.upgradePoints, 0);
    assert.equal(applyUpgrade(s, 'damage'), false);
  });

  it('banks several points when a big orb pays for more than one', () => {
    const s = quiet();
    giveOrb(s, 450);
    step(s, DT, still);
    assert.equal(s.upgradePoints, 2);
    assert.equal(s.xp, 50);
  });

  it('splits the shop into weapons, defense and companions', () => {
    assert.deepEqual(SHOP_SECTIONS.map((section) => section.id), ['weapons', 'defense', 'companions']);
    const inSection = (id) => SHOP_SECTIONS.find((section) => section.id === id).items;
    assert.ok(inSection('weapons').includes('pump'));
    for (const item of ['health', 'regen', 'laser']) assert.ok(inSection('defense').includes(item));
    for (const item of ['companion', 'companion2']) assert.ok(inSection('companions').includes(item));
  });

  it('offers only what can be bought yet', () => {
    assert.deepEqual(
      availableUpgrades(quiet()).sort(),
      ['companion', 'companion2', 'damage', 'fireRate', 'health', 'laser', 'pierce', 'pump', 'regen'],
    );
  });

  it('shows locked items with the reason and how many were bought', () => {
    const s = quiet();
    const item = (id) => shopSections(s).flatMap((section) => section.items).find((entry) => entry.id === id);
    assert.equal(item('laserRate').state, 'needsLaser');
    assert.equal(item('companionDamage').state, 'needsCompanion');
    levelUp(s);
    applyUpgrade(s, 'damage');
    levelUp(s);
    applyUpgrade(s, 'laser');
    assert.equal(item('damage').bought, 1);
    assert.equal(item('laser').state, 'owned');
    assert.equal(item('laserRate').state, 'ready');
  });

  it('health replenishment heals over time, stacks, and stops at maximum', () => {
    const s = quiet();
    s.player.hp = 50;
    levelUp(s);
    applyUpgrade(s, 'regen');
    levelUp(s);
    applyUpgrade(s, 'regen');
    for (let i = 0; i < 60; i++) step(s, DT, still);
    assert.ok(Math.abs(s.player.hp - (50 + 2 * s.cfg.gameplay.upgradeRegen)) < 0.01);
    s.player.hp = s.player.maxHp - 0.01;
    for (let i = 0; i < 60; i++) step(s, DT, still);
    assert.equal(s.player.hp, s.player.maxHp);
  });

  describe('personal laser', () => {
    function armed(edit) {
      const s = quiet(edit);
      s.player.cool = 1e9;
      levelUp(s);
      applyUpgrade(s, 'laser');
      return s;
    }
    const bullet = (s, x, y, vx, vy, extra = {}) => {
      const b = { x, y, vx, vy, ttl: 5, r: 7, damage: 10, ...extra };
      s.bullets.push(b);
      return b;
    };

    it('shoots down a bullet coming at the player', () => {
      const s = armed();
      bullet(s, 150, 0, -300, 0);
      step(s, DT, still);
      assert.equal(s.bullets.length, 0);
      assert.ok(s.events.some((e) => e.type === 'laser'));
    });

    it('does nothing before it is bought', () => {
      const s = quiet();
      bullet(s, 150, 0, -300, 0);
      step(s, DT, still);
      assert.equal(s.bullets.length, 1);
    });

    it('leaves bullets flying away or out of reach', () => {
      const s = armed();
      bullet(s, 150, 0, 300, 0);
      bullet(s, s.cfg.gameplay.laserRange + 50, 0, -300, 0);
      step(s, DT, still);
      assert.equal(s.bullets.length, 2);
    });

    it('leaves the large ball alone', () => {
      const s = armed();
      bullet(s, 150, 0, -300, 0, { ball: true });
      step(s, DT, still);
      assert.equal(s.bullets.length, 1);
    });

    it('must recharge between shots, and the upgrade shortens that', () => {
      const interval = (s) => {
        bullet(s, 150, 0, -1, 0);
        step(s, DT, still);
        return s.laser.cool;
      };
      assert.ok(Math.abs(interval(armed()) - 0.9) < 1e-9);
      const s = armed((c) => { c.gameplay.upgradeLaserRate = 100; });
      levelUp(s);
      applyUpgrade(s, 'laserRate');
      assert.ok(Math.abs(interval(s) - 0.45) < 1e-9);
    });

    it('reaches further with the range upgrade', () => {
      const s = armed();
      levelUp(s);
      applyUpgrade(s, 'laserRange');
      bullet(s, s.cfg.gameplay.laserRange + 30, 0, -1, 0);
      step(s, DT, still);
      assert.equal(s.bullets.length, 0);
    });

    it('takes the nearest bullets, and more of them with the beams upgrade', () => {
      const s = armed();
      bullet(s, 170, 0, -1, 0);
      const near = bullet(s, 60, 0, -1, 0);
      bullet(s, 120, 0, -1, 0);
      step(s, DT, still);
      assert.equal(s.bullets.length, 2);
      assert.equal(s.bullets.includes(near), false);

      const t = armed();
      levelUp(t);
      applyUpgrade(t, 'laserBeams');
      bullet(t, 170, 0, -1, 0);
      bullet(t, 60, 0, -1, 0);
      bullet(t, 120, 0, -1, 0);
      step(t, DT, still);
      assert.equal(t.bullets.length, 1);
    });
  });

  describe('companion upgrades', () => {
    function withBoth(edit) {
      const s = quiet((c) => { c.gameplay.companionKills = 200; c.gameplay.companionDistance = 300; edit?.(c); });
      levelUp(s);
      applyUpgrade(s, 'companion');
      levelUp(s);
      applyUpgrade(s, 'companion2');
      return s;
    }

    it('the second companion is its own character with its own stats', () => {
      const s = withBoth();
      const second = s.companions.find((m) => m.role === 'companion2');
      assert.equal(second.maxHp, s.cfg.characters.companion2.hp);
      assert.notEqual(s.cfg.characters.companion2.name, s.cfg.characters.companion.name);
      placeEnemy(s, 'enemy2', second.x + 100, second.y).speed = 0;
      s.player.cool = 1e9;
      s.companions[0].cool = 1e9;
      step(s, DT, still);
      assert.equal(s.shots[0].damage, s.cfg.characters.companion2.damage);
      assert.ok(s.events.some((e) => e.type === 'shot' && e.role === 'companion2'));
    });

    it('is not offered when the map has it switched off', () => {
      const s = quiet((c) => { c.characters.companion2.enabled = false; });
      assert.equal(availableUpgrades(s).includes('companion2'), false);
      assert.equal(shopSections(s).flatMap((section) => section.items).some((item) => item.id === 'companion2'), false);
    });

    it('both companions share the team limit', () => {
      const s = quiet((c) => { c.gameplay.companionKills = 200; c.gameplay.companionDistance = 300; });
      for (let i = 0; i < 6; i++) { levelUp(s); applyUpgrade(s, i % 2 ? 'companion' : 'companion2'); }
      const offered = availableUpgrades(s);
      assert.equal(offered.includes('companion'), false);
      assert.equal(offered.includes('companion2'), false);
    });

    it('the damage and fire rate upgrades apply to both, from base values', () => {
      const s = withBoth((c) => { c.gameplay.upgradeCompanionDamage = 50; c.gameplay.upgradeCompanionFireRate = 100; });
      levelUp(s);
      applyUpgrade(s, 'companionDamage');
      levelUp(s);
      applyUpgrade(s, 'companionFireRate');
      for (const m of s.companions) placeEnemy(s, 'enemy2', m.x + 100, m.y).speed = 0;
      s.player.cool = 1e9;
      step(s, DT, still);
      const { companion, companion2 } = s.cfg.characters;
      assert.deepEqual(s.shots.map((p) => p.damage).sort((a, b) => a - b), [companion.damage * 1.5, companion2.damage * 1.5]);
      assert.ok(Math.abs(s.companions[1].cool - companion2.fireInterval / 2) < 1e-9);
    });

    it('the health upgrade raises current and maximum, and covers later companions', () => {
      const s = quiet((c) => { c.gameplay.companionKills = 200; c.gameplay.companionDistance = 300; c.gameplay.upgradeCompanionHealth = 50; });
      levelUp(s);
      applyUpgrade(s, 'companion');
      const [first] = s.companions;
      first.hp = 10;
      levelUp(s);
      applyUpgrade(s, 'companionHealth');
      const { companion, companion2 } = s.cfg.characters;
      assert.equal(first.maxHp, companion.hp * 1.5);
      assert.equal(first.hp, 10 + companion.hp * 0.5);
      levelUp(s);
      applyUpgrade(s, 'companion2');
      assert.equal(s.companions[1].maxHp, companion2.hp * 1.5);
    });

    it('a companion upgrade cannot be bought with nobody to give it to', () => {
      const s = quiet();
      levelUp(s);
      assert.equal(applyUpgrade(s, 'companionDamage'), false);
      assert.equal(s.upgradePoints, 1);
    });
  });

  it('a fire rate upgrade shortens the time between shots, and stacks', () => {
    const s = quiet();
    const base = s.cfg.characters.player.fireInterval;
    levelUp(s);
    applyUpgrade(s, 'fireRate');
    step(s, DT, { x: 0, y: 0, aimX: 1, aimY: 0 });
    assert.ok(Math.abs(s.player.cool - base / 1.2) < 1e-9);
    levelUp(s);
    applyUpgrade(s, 'fireRate');
    s.player.cool = 0;
    step(s, DT, { x: 0, y: 0, aimX: 1, aimY: 0 });
    assert.ok(Math.abs(s.player.cool - base / 1.4) < 1e-9);
  });

  it('a fire rate upgrade uses the admin-set amount and also speeds up the pump', () => {
    const s = quiet((c) => { c.gameplay.upgradeFireRate = 100; });
    levelUp(s);
    applyUpgrade(s, 'pump');
    step(s, DT, { x: 0, y: 0, aimX: 1, aimY: 0 });
    const pumpCool = s.player.cool;
    levelUp(s);
    applyUpgrade(s, 'fireRate');
    s.player.cool = 0;
    step(s, DT, { x: 0, y: 0, aimX: 1, aimY: 0 });
    assert.ok(Math.abs(s.player.cool - pumpCool / 2) < 1e-9);
  });

  it('a fire rate upgrade leaves companions alone', () => {
    const s = quiet((c) => { c.gameplay.companionKills = 0; });
    step(s, DT, still);
    levelUp(s);
    applyUpgrade(s, 'fireRate');
    s.player.cool = 1e9;
    placeEnemy(s, 'enemy2', s.companions[0].x + 100, s.companions[0].y).speed = 0;
    for (let i = 0; i < 40 && !s.shots.length; i++) step(s, DT, still);
    assert.ok(Math.abs(s.companions[0].cool - (s.cfg.characters.companion.fireInterval - DT * 0)) < 0.05);
  });

  it('refuses a choice with no point to spend, or one not on offer', () => {
    const s = quiet();
    assert.equal(applyUpgrade(s, 'damage'), false);
    assert.equal(s.gun.damagePercent, 0);
    levelUp(s);
    assert.equal(applyUpgrade(s, 'invincible'), false);
    assert.equal(s.upgradePoints, 1);
  });

  it('adds damage to the shots the player fires', () => {
    const s = quiet();
    levelUp(s);
    applyUpgrade(s, 'damage');
    step(s, DT, { x: 0, y: 0, aimX: 1, aimY: 0 });
    assert.ok(Math.abs(s.shots[0].damage - s.cfg.characters.player.damage * 1.2) < 1e-9);
  });

  it('stacks the damage percentage on base damage, not on itself', () => {
    const s = quiet();
    for (let i = 0; i < 2; i++) { levelUp(s); applyUpgrade(s, 'damage'); }
    step(s, DT, { x: 0, y: 0, aimX: 1, aimY: 0 });
    assert.ok(Math.abs(s.shots[0].damage - s.cfg.characters.player.damage * 1.4) < 1e-9);
  });

  it('adds to both maximum and current health', () => {
    const s = quiet();
    s.player.hp = 50;
    levelUp(s);
    applyUpgrade(s, 'health');
    assert.equal(s.player.maxHp, s.cfg.characters.player.hp + 20);
    assert.equal(s.player.hp, 70);
  });

  it('uses the admin-set upgrade amounts', () => {
    const s = quiet((c) => { c.gameplay.upgradeDamage = 5; c.gameplay.upgradeHealth = 7; });
    levelUp(s);
    applyUpgrade(s, 'damage');
    levelUp(s);
    applyUpgrade(s, 'health');
    assert.equal(s.gun.damagePercent, 5);
    assert.equal(s.player.maxHp, s.cfg.characters.player.hp + 7);
  });

  it('pump fires a short spread, slower, and leaves the menu once owned', () => {
    const s = quiet();
    const single = s.cfg.characters.player.fireInterval;
    levelUp(s);
    applyUpgrade(s, 'pump');
    step(s, DT, { x: 0, y: 0, aimX: 1, aimY: 0 });
    assert.equal(s.shots.length, 5);
    assert.ok(new Set(s.shots.map((p) => p.vy.toFixed(2))).size === 5);
    assert.ok(s.shots[0].ttl < 0.95);
    assert.ok(s.player.cool > single);
    assert.equal(availableUpgrades(s).includes('pump'), false);
  });

  it('pump auto-aim waits until a target is within its reach', () => {
    const s = quiet();
    levelUp(s);
    applyUpgrade(s, 'pump');
    placeEnemy(s, 'enemy2', 420, 0).speed = 0;
    step(s, DT, still);
    assert.equal(s.shots.length, 0);
  });

  it('a companion upgrade adds one now, and the usual one still joins later', () => {
    const s = quiet((c) => { c.gameplay.companionKills = 3; });
    levelUp(s);
    applyUpgrade(s, 'companion');
    assert.equal(s.companions.length, 1);
    s.kills = 3;
    step(s, DT, still);
    assert.equal(s.companions.length, 2);
    step(s, DT, still);
    assert.equal(s.companions.length, 2);
  });

  it('companions spread out around the player', () => {
    const s = quiet((c) => { c.gameplay.companionKills = 0; });
    for (let i = 0; i < 2; i++) { levelUp(s); applyUpgrade(s, 'companion'); }
    for (let i = 0; i < 60 * 4; i++) step(s, DT, still);
    assert.equal(s.companions.length, 3);
    assert.ok(dist(s.companions[0], s.companions[1]) > 80);
    assert.ok(dist(s.companions[1], s.companions[2]) > 80);
  });

  it('stops offering companions at the cap', () => {
    const s = quiet((c) => { c.gameplay.companionKills = 200; c.gameplay.companionDistance = 300; });
    for (let i = 0; i < 6; i++) { levelUp(s); applyUpgrade(s, 'companion'); }
    assert.equal(availableUpgrades(s).includes('companion'), false);
  });

  function lineOfTargets(s, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const e = placeEnemy(s, 'enemy2', 80 + i * 60, 0);
      e.speed = 0;
      e.hp = e.maxHp = 1e9;
      out.push(e);
    }
    return out;
  }
  const fireOne = (s) => {
    step(s, DT, { x: 0, y: 0, aimX: 1, aimY: 0 });
    s.player.cool = 1e9;
    for (let i = 0; i < 60; i++) step(s, DT, still);
  };
  const struck = (targets) => targets.filter((e) => e.hp < e.maxHp).length;

  it('a normal bullet stops at the first enemy', () => {
    const s = quiet();
    const targets = lineOfTargets(s, 3);
    fireOne(s);
    assert.equal(struck(targets), 1);
  });

  it('each pierce upgrade lets a bullet through one more enemy', () => {
    const s = quiet();
    levelUp(s);
    applyUpgrade(s, 'pierce');
    const targets = lineOfTargets(s, 3);
    fireOne(s);
    assert.equal(struck(targets), 2);

    const t = quiet();
    for (let i = 0; i < 2; i++) { levelUp(t); applyUpgrade(t, 'pierce'); }
    const more = lineOfTargets(t, 4);
    fireOne(t);
    assert.equal(struck(more), 3);
  });

  it('a piercing bullet hits each enemy only once', () => {
    const s = quiet();
    for (let i = 0; i < 3; i++) { levelUp(s); applyUpgrade(s, 'pierce'); }
    const [only] = lineOfTargets(s, 1);
    fireOne(s);
    assert.equal(only.maxHp - only.hp, s.cfg.characters.player.damage);
  });

  it('companion bullets do not pierce', () => {
    const s = quiet((c) => { c.gameplay.companionKills = 0; });
    levelUp(s);
    applyUpgrade(s, 'pierce');
    step(s, DT, still);
    s.player.cool = 1e9;
    placeEnemy(s, 'enemy2', s.companions[0].x + 100, s.companions[0].y).speed = 0;
    for (let i = 0; i < 40 && !s.shots.length; i++) step(s, DT, still);
    assert.equal(s.shots[0].ally, true);
    assert.equal(s.shots[0].pierce, 0);
  });
});

describe('enemy 5', () => {
  function withEnemy5(x = 300, edit) {
    const s = game(1, edit);
    s.spawnT = 1e9;
    s.cfg.characters.player.damage = 0;
    s.player.hp = s.player.maxHp = 1e9;
    const e = placeEnemy(s, 'enemy5', x, 0);
    e.attack = 'ball';
    e.ballT = s.cfg.characters.enemy5.fireInterval;
    e.speed = 0;
    return { s, e };
  }

  it('is the strongest and the rarest regular enemy', () => {
    const { maps } = defaultConfig();
    for (const { characters: c } of Object.values(maps)) {
      assert.ok(c.enemy5.hp > c.enemy1.hp && c.enemy5.damage > c.enemy1.damage);
    }
    assert.ok(maps.grid.characters.enemy5.spawnChance < maps.grid.characters.enemy1.spawnChance);
  });

  it('spawns with its chance, ready to throw', () => {
    const s = game(3, (c) => { c.characters.enemy1.spawnChance = 0; c.characters.enemy2.spawnChance = 0; c.characters.enemy5.spawnChance = 1; });
    s.time = 41;
    s.spawnT = 0;
    step(s, DT, still);
    assert.equal(s.enemies[0].kind, 'enemy5');
    assert.equal(s.enemies[0].attack, 'ball');
    assert.ok(s.events.some((event) => event.type === 'enemy5'));
  });

  it('does not appear in the opening of a run', () => {
    const s = game(3, (c) => { c.characters.enemy5.spawnChance = 1; });
    s.spawnT = 0;
    step(s, DT, still);
    assert.notEqual(s.enemies[0].kind, 'enemy5');
  });

  it('throws one large ball every 3 seconds by default', () => {
    const { s } = withEnemy5();
    const times = [];
    let seen = new Set();
    for (let i = 0; i < 60 * 10; i++) {
      step(s, DT, still);
      for (const b of s.bullets) {
        if (!seen.has(b)) { seen.add(b); times.push(s.time); }
      }
    }
    assert.equal(times.length, 3);
    assert.ok(Math.abs(times[1] - times[0] - 3) < 0.05, String(times));
    assert.ok(Math.abs(times[2] - times[1] - 3) < 0.05, String(times));
  });

  it('uses the ball\'s own size, speed and damage', () => {
    const { s } = withEnemy5(300, (c) => { c.characters.ball.size = 100; c.characters.ball.speed = 123; c.characters.ball.damage = 7; });
    for (let i = 0; i < 60 * 4 && !s.bullets.length; i++) step(s, DT, still);
    const [b] = s.bullets;
    assert.equal(b.ball, true);
    assert.equal(b.damage, 7);
    assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - 123) < 1e-6);
    assert.ok(b.r > 30);
  });

  it('shows the line first and throws along it, so the ball can be dodged', () => {
    const { s, e } = withEnemy5();
    for (let i = 0; i < 60 * 4 && !(e.windup > 0); i++) step(s, DT, still);
    assert.ok(e.windup > 0);
    const locked = e.aim;
    s.player.y = 200;
    for (let i = 0; i < 60 && !s.bullets.length; i++) step(s, DT, still);
    assert.ok(Math.abs(Math.atan2(s.bullets[0].vy, s.bullets[0].vx) - locked) < 1e-9);
  });

  it('does not throw from outside the player\'s view', () => {
    const { s, e } = withEnemy5();
    e.x = s.view.halfW + 60;
    for (let i = 0; i < 60 * 7; i++) step(s, DT, still);
    assert.equal(s.bullets.length, 0);
  });

  it('hits on contact too', () => {
    const { s, e } = withEnemy5(5);
    step(s, DT, still);
    assert.equal(s.player.maxHp - s.player.hp, e.damage);
  });

  it('a ball hurts the player it reaches', () => {
    const { s } = withEnemy5(2000);
    s.enemies.length = 0;
    s.bullets.push({ x: 0, y: 0, vx: 0, vy: 0, ttl: 5, r: 40, damage: 35, ball: true });
    step(s, DT, still);
    assert.equal(s.player.maxHp - s.player.hp, 35);
    assert.equal(s.bullets.length, 0);
  });

  it('drops its XP when destroyed', () => {
    const { s, e } = withEnemy5(300);
    e.hp = 1;
    s.shots.push({ x: 300, y: 0, vx: 0, vy: 0, ttl: 1, damage: 10 });
    step(s, DT, still);
    assert.deepEqual(s.orbs.map((o) => o.xp), [s.cfg.characters.enemy5.xp]);
  });
});

describe('maps', () => {
  const forest = (seed = 5, edit = () => {}) => game(seed, edit, 'forest');
  const itemsAround = (s, x, y, half) => {
    const items = [];
    forEachItemIn(s.world, x - half, y - half, x + half, y + half, (item) => items.push(item));
    return items;
  };

  it('uses the chosen map\'s characters', () => {
    const grid = game(1);
    const woods = forest(1);
    assert.notEqual(grid.cfg.characters.player.name, woods.cfg.characters.player.name);
  });

  it('the first map has no obstacles', () => {
    assert.equal(game(1).world, null);
  });

  it('has both forests and exploded tanks all over', () => {
    const s = forest();
    for (const [x, y] of [[4000, 4000], [-9000, 2000], [30000, -30000]]) {
      const items = itemsAround(s, x, y, 2000);
      assert.ok(items.filter((i) => i.kind === 'tree').length > 30);
      assert.ok(items.filter((i) => i.kind === 'tank').length > 5);
    }
  });

  it('builds the same world every time for one seed, and a different one for another', () => {
    const a = createGame(mapConfig(defaultConfig(), 'forest'), { rng: seeded(11) });
    const b = createGame(mapConfig(defaultConfig(), 'forest'), { rng: seeded(11) });
    const c = createGame(mapConfig(defaultConfig(), 'forest'), { rng: seeded(12) });
    const shape = (s) => JSON.stringify(itemsAround(s, 3000, 3000, 900));
    assert.equal(shape(a), shape(b));
    assert.notEqual(shape(a), shape(c));
  });

  it('keeps the start and the boss arena clear', () => {
    for (let seed = 1; seed < 15; seed++) {
      const s = forest(seed);
      const arena = s.cfg.gameplay.arenaRadius;
      for (const item of itemsAround(s, 0, 0, 300)) assert.ok(Math.hypot(item.x, item.y) > 260);
      for (const item of itemsAround(s, s.hostage.x, s.hostage.y, arena + 100)) {
        assert.ok(dist(item, s.hostage) > arena + 60);
      }
    }
  });

  function besideTree(s) {
    const tree = itemsAround(s, 3000, 3000, 800).find((item) => item.kind === 'tree');
    assert.ok(tree);
    return tree;
  }

  it('trees block the player, who slides around them', () => {
    const s = forest();
    s.spawnT = 1e9;
    const tree = besideTree(s);
    s.player.x = tree.x - 100;
    s.player.y = tree.y;
    for (let i = 0; i < 60 * 3; i++) {
      step(s, DT, { x: 1, y: 0 });
      assert.equal(hitsSolid(s.world, s.player.x, s.player.y), false);
    }
    assert.ok(s.player.x > tree.x, 'walking straight at a trunk still gets past it');
  });

  it('bullets stop at obstacles', () => {
    const s = forest();
    s.spawnT = 1e9;
    const tree = besideTree(s);
    s.player.x = tree.x - 80;
    s.player.y = tree.y;
    s.shots.push({ x: tree.x - 40, y: tree.y, vx: 680, vy: 0, ttl: 1, damage: 5 });
    s.bullets.push({ x: tree.x - 40, y: tree.y + 3, vx: 300, vy: 0, ttl: 1, r: 6, damage: 5 });
    s.player.cool = 1e9;
    for (let i = 0; i < 12; i++) step(s, DT, still);
    assert.equal(s.shots.length, 0);
    assert.equal(s.bullets.length, 0);
    assert.ok(s.events.some((event) => event.type === 'impact'));
  });

  it('the large ball rolls through obstacles', () => {
    const s = forest();
    s.spawnT = 1e9;
    const tree = besideTree(s);
    s.player.x = tree.x - 400;
    s.player.y = tree.y;
    s.bullets.push({ x: tree.x - 60, y: tree.y, vx: 300, vy: 0, ttl: 1, r: 38, damage: 5, ball: true });
    s.player.cool = 1e9;
    for (let i = 0; i < 30; i++) step(s, DT, still);
    assert.equal(s.bullets.length, 1);
  });

  it('chasing enemies get around trees', () => {
    const s = forest();
    s.spawnT = 1e9;
    s.cfg.characters.player.damage = 0;
    s.player.hp = s.player.maxHp = 1e9;
    const tree = besideTree(s);
    s.player.x = tree.x + 70;
    s.player.y = tree.y;
    placeEnemy(s, 'enemy2', tree.x - 70, tree.y);
    for (let i = 0; i < 60 * 5; i++) step(s, DT, still);
    assert.ok(s.player.hp < s.player.maxHp);
  });

  it('a simple bot can finish the forest map, so it is winnable', () => {
    let wins = 0;
    const results = [];
    for (let seed = 1; seed <= 40; seed++) { // this bot wins about 3 games in 10, so a few seeds prove little
      const s = forest(seed * 37);
      let frames = 0;
      const picks = ['damage', 'companion', 'health', 'pierce'];
      while (s.status === 'playing' && frames < 60 * 300) {
        if (s.upgradePoints) applyUpgrade(s, picks[s.kills % picks.length]);
        step(s, DT, bot(s));
        frames += 1;
        s.events.length = 0;
      }
      results.push(`${s.status}:${Math.round(s.time)}s/${s.kills}k`);
      if (s.status === 'won') wins += 1;
    }
    assert.ok(wins >= 6, results.join(' '));
    console.log('forest bot results', results.join(' '));
  });
});

describe('turning characters off', () => {
  const spawnKinds = (edit, time = 200) => {
    const s = game(4, (c) => { c.gameplay.maxEnemies = 1e6; c.gameplay.spawnInterval = 0.1; edit(c); });
    s.time = time;
    s.player.hp = s.player.maxHp = 1e9;
    s.cfg.characters.player.damage = 0;
    const seen = new Set();
    for (let i = 0; i < 60 * 40; i++) {
      step(s, DT, still);
      for (const e of s.enemies) seen.add(e.kind);
      s.enemies.length = 0;
    }
    return seen;
  };

  for (const kind of ['enemy1', 'enemy2', 'enemy5', 'jet']) {
    it(`never spawns ${kind} when it is off`, () => {
      assert.equal(spawnKinds((c) => { c.characters[kind].enabled = false; c.characters.jet.spawnChance = 0.2; c.characters.enemy5.spawnChance = 0.2; c.characters.enemy1.spawnChance = 0.2; }).has(kind), false);
    });
  }

  it('still spawns when only the rare enemy is left on', () => {
    const seen = spawnKinds((c) => { c.characters.enemy2.enabled = false; c.characters.enemy5.enabled = false; c.characters.enemy1.spawnChance = 0.01; });
    assert.ok(seen.has('enemy1'));
  });

  it('with the boss off the hostage can be reached at once, and enemies keep coming', () => {
    const s = game(2, (c) => { c.characters.boss.enabled = false; });
    assert.equal(s.boss.alive, false);
    s.spawnT = 0;
    step(s, DT, still);
    assert.ok(s.enemies.length > 0);
    s.player.x = s.hostage.x;
    s.player.y = s.hostage.y;
    step(s, DT, still);
    assert.equal(s.status, 'won');
  });

  it('with the companion off none joins and the upgrade is not offered', () => {
    const s = game(2, (c) => { c.characters.companion.enabled = false; c.gameplay.companionKills = 0; });
    s.spawnT = 1e9;
    for (let i = 0; i < 30; i++) step(s, DT, still);
    assert.equal(s.companions.length, 0);
    assert.equal(availableUpgrades(s).includes('companion'), false);
  });
});

describe('difficulty levels', () => {
  const quiet = (edit) => {
    const s = game(1, (c) => { c.gameplay.difficultyKills = 2; c.gameplay.difficultyIncrease = 50; edit?.(c); });
    s.spawnT = 1e9;
    return s;
  };
  const killOne = (s) => {
    const e = placeEnemy(s, 'enemy2', 120, 0);
    e.hp = 1;
    e.speed = 0;
    for (let i = 0; i < 60 && s.enemies.includes(e); i++) step(s, DT, still);
  };
  const spawn = (s, kind, chance) => {
    s.cfg.characters.enemy1.spawnChance = chance;
    s.cfg.characters.enemy2.spawnChance = 1 - chance;
    s.spawnT = 0;
    step(s, DT, still);
    s.spawnT = 1e9;
    return s.enemies.at(-1);
  };

  it('starts at level 1 and rises every set number of kills', () => {
    const s = quiet();
    assert.equal(s.level, 1);
    killOne(s);
    assert.equal(s.level, 1);
    killOne(s);
    assert.equal(s.level, 2);
    assert.ok(s.events.some((e) => e.type === 'difficulty' && e.level === 2));
  });

  it('new enemies gain health, damage and XP, but no speed or size', () => {
    const s = quiet((c) => { c.characters.jet.spawnChance = 0; c.characters.enemy5.spawnChance = 0; });
    s.level = 3;
    const ch = s.cfg.characters.enemy1;
    const e = spawn(s, 'enemy1', 1);
    assert.equal(e.maxHp, ch.hp * 2);
    assert.equal(e.damage, ch.damage * 2);
    assert.equal(e.size, ch.size);
    assert.equal(e.xp, ch.xp * 2);
    assert.ok(e.speed <= ch.speed * 1.08);
  });

  it('leaves the admin settings untouched', () => {
    const s = quiet();
    const before = s.cfg.characters.enemy1.hp;
    killOne(s);
    killOne(s);
    assert.equal(s.cfg.characters.enemy1.hp, before);
  });

  it('brings the boss up to the level, keeping its share of health', () => {
    const s = quiet();
    s.boss.hp = s.boss.maxHp / 2;
    killOne(s);
    killOne(s);
    assert.equal(s.boss.maxHp, s.cfg.characters.boss.hp * 1.5);
    assert.equal(s.boss.hp, s.boss.maxHp / 2);
    assert.equal(s.boss.size, s.cfg.characters.boss.size);
  });

  it('an increase of zero changes nothing', () => {
    const s = quiet((c) => { c.gameplay.difficultyIncrease = 0; c.characters.jet.spawnChance = 0; c.characters.enemy5.spawnChance = 0; });
    s.level = 9;
    assert.equal(spawn(s, 'enemy1', 1).maxHp, s.cfg.characters.enemy1.hp);
  });
});

describe('Su-34 and Kh-29', () => {
  function withJet(edit) {
    const s = game(1, (c) => {
      c.characters.jet.spawnChance = 1;
      for (const kind of ['enemy1', 'enemy2', 'enemy5']) c.characters[kind].spawnChance = 0;
      edit?.(c);
    });
    s.time = 61;
    s.spawnT = 0;
    s.cfg.characters.player.damage = 0;
    s.player.hp = s.player.maxHp = 1e9;
    step(s, DT, still);
    s.spawnT = 1e9;
    return { s, jet: s.enemies.find((e) => e.kind === 'jet') };
  }
  const onlyMissile = (edit) => {
    const { s, jet } = withJet(edit);
    s.enemies.length = 0;
    s.missiles.length = 0;
    const ch = s.cfg.characters.missile;
    const m = { x: 300, y: 0, vx: -ch.speed, vy: 0, heading: Math.PI, r: ch.size * 0.42, damage: ch.damage, ttl: 8 };
    s.missiles.push(m);
    return { s, m, jet };
  };

  it('is very rare and never in the opening of a run', () => {
    const { characters } = defaultConfig().maps.grid;
    assert.ok(characters.jet.spawnChance < characters.enemy5.spawnChance);
    const s = game(1, (c) => { c.characters.jet.spawnChance = 1; });
    s.spawnT = 0;
    step(s, DT, still);
    assert.equal(s.enemies.some((e) => e.kind === 'jet'), false);
  });

  it('flies past in a straight line at full speed, then leaves', () => {
    const { s, jet } = withJet();
    const start = { x: jet.x, y: jet.y };
    for (let i = 0; i < 60; i++) step(s, DT, still);
    assert.ok(Math.abs(dist(jet, start) - s.cfg.characters.jet.speed) < 20);
    for (let i = 0; i < 60 * 31; i++) step(s, DT, still);
    assert.equal(s.enemies.includes(jet), false);
  });

  it('only one is in the air at a time', () => {
    const { s } = withJet();
    for (let i = 0; i < 5; i++) { s.spawnT = 0; step(s, DT, still); }
    assert.equal(s.enemies.filter((e) => e.kind === 'jet').length, 1);
  });

  it('launches missiles once in view', () => {
    const { s } = withJet();
    assert.equal(s.missiles.length, 0);
    for (let i = 0; i < 60 * 3 && !s.missiles.length; i++) step(s, DT, still);
    assert.ok(s.missiles.length > 0);
  });

  it('can be destroyed for its XP', () => {
    const { s, jet } = withJet();
    jet.hp = 1;
    s.shots.push({ x: jet.x, y: jet.y, vx: 0, vy: 0, ttl: 1, damage: 5 });
    step(s, DT, still);
    assert.equal(s.kills, 1);
    assert.equal(s.orbs[0].xp, s.cfg.characters.jet.xp);
  });

  it('a missile turns to follow the player', () => {
    const { s, m } = onlyMissile();
    m.heading = 0;
    s.player.y = 0;
    const offCourse = Math.abs(Math.atan2(Math.sin(Math.PI - m.heading), Math.cos(Math.PI - m.heading)));
    for (let i = 0; i < 30; i++) step(s, DT, still);
    assert.ok(Math.abs(Math.atan2(Math.sin(Math.PI - m.heading), Math.cos(Math.PI - m.heading))) < offCourse);
  });

  it('a missile cannot be outrun in a straight line by default', () => {
    const { missile, player } = mapConfig(defaultConfig(), 'grid').characters;
    assert.ok(missile.speed > player.speed);
  });

  it('a missile that arrives hurts and is spent', () => {
    const { s, m } = onlyMissile();
    m.x = 5;
    step(s, DT, still);
    assert.equal(s.player.maxHp - s.player.hp, m.damage);
    assert.equal(s.missiles.length, 0);
  });

  it('one click on a missile destroys it, without counting as a kill', () => {
    const { s, m } = onlyMissile();
    assert.equal(destroyMissileAt(s, m.x + 5, m.y, 20), true);
    assert.equal(s.missiles.length, 0);
    assert.equal(s.kills, 0);
    assert.equal(s.orbs.length, 0);
    assert.ok(s.events.some((event) => event.type === 'missileDown'));
  });

  it('a click that misses does nothing', () => {
    const { s } = onlyMissile();
    assert.equal(destroyMissileAt(s, 0, 300, 20), false);
    assert.equal(s.missiles.length, 1);
  });

  it('a click takes only the nearest missile', () => {
    const { s, m } = onlyMissile();
    const other = { ...m, x: m.x + 30 };
    s.missiles.push(other);
    destroyMissileAt(s, other.x - 2, other.y, 60);
    assert.deepEqual(s.missiles, [m]);
  });

  it('a click covers the whole of a large missile', () => {
    const { s, m } = onlyMissile();
    m.r = 80;
    assert.equal(destroyMissileAt(s, m.x + 70, m.y, 20), true);
  });

  it('clicks do nothing while the game is frozen', () => {
    const { s, m } = onlyMissile();
    s.status = 'won';
    assert.equal(destroyMissileAt(s, m.x, m.y, 20), false);
    assert.equal(s.missiles.length, 1);
  });

  it('bullets pass straight through a missile', () => {
    const { s, m } = onlyMissile();
    s.player.cool = 1e9;
    const shot = { x: m.x, y: m.y, vx: 0, vy: 0, ttl: 1, damage: 1e6 };
    s.shots.push(shot);
    step(s, DT, still);
    assert.equal(s.missiles.length, 1);
    assert.ok(s.shots.includes(shot));
  });

  it('auto-aim ignores missiles', () => {
    const { s } = onlyMissile((c) => { c.characters.player.damage = 18; });
    for (let i = 0; i < 20; i++) step(s, DT, still);
    assert.equal(s.shots.length, 0);
  });

  it('runs out of fuel', () => {
    const { s, m } = onlyMissile();
    m.ttl = 0.01;
    m.x = 900;
    step(s, DT, still);
    step(s, DT, still);
    assert.equal(s.missiles.length, 0);
    assert.equal(s.player.hp, s.player.maxHp);
  });

  it('missiles hit harder with difficulty, but go no faster', () => {
    const { s, jet } = withJet((c) => { c.gameplay.difficultyIncrease = 100; });
    s.level = 2;
    for (let i = 0; i < 60 * 3 && !s.missiles.length; i++) step(s, DT, still);
    const [m] = s.missiles;
    const ch = s.cfg.characters.missile;
    assert.ok(jet);
    assert.equal(m.damage, ch.damage * 2);
    step(s, DT, still);
    assert.ok(Math.abs(Math.hypot(m.vx, m.vy) - ch.speed) < 1e-6);
  });

  it('missiles vanish when the boss falls', () => {
    const { s } = onlyMissile();
    s.player.x = s.hostage.x + 400;
    s.player.y = s.hostage.y;
    s.missiles[0].x = s.player.x + 900;
    s.boss.hp = 1;
    s.boss.mode = 'fight';
    s.shots.push({ x: s.boss.x, y: s.boss.y, vx: 0, vy: 0, ttl: 1, damage: 10 });
    step(s, DT, still);
    assert.equal(s.missiles.length, 0);
  });
});

describe('score limits', () => {
  it('real wins always fall inside the limits the server enforces', () => {
    let wins = 0;
    for (const mapId of ['grid', 'forest']) {
      for (let seed = 1; seed <= 16; seed++) {
        const s = game(seed * 53, () => {}, mapId);
        const picks = ['damage', 'companion', 'health', 'pierce'];
        for (let frames = 0; s.status === 'playing' && frames < 60 * 300; frames++) {
          if (s.upgradePoints) applyUpgrade(s, picks[s.kills % picks.length]);
          step(s, DT, bot(s));
          s.events.length = 0;
        }
        if (s.status !== 'won') continue;
        wins += 1;
        const { minTime, minSpawnGap } = scoreLimits(s.cfg);
        assert.ok(s.time >= minTime, `${s.time} < ${minTime}`);
        assert.ok(s.kills <= s.time / minSpawnGap + 1, `${s.kills} kills in ${s.time}s`);
      }
    }
    assert.ok(wins > 0);
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
      const picks = ['damage', 'companion', 'health', 'pierce'];
      while (s.status === 'playing' && frames < 60 * 240) {
        if (s.upgradePoints) applyUpgrade(s, picks[s.kills % picks.length]);
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
