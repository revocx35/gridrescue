import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MAPS, defaultConfig, validateConfig } from '../public/js/schema.js';
import { InvalidPng, MAX_SPRITE_BYTES, sanitizePng } from '../src/png.js';
import { Store } from '../src/store.js';
import { authed, chunk, makeApp, makePng, signIn } from './helpers.js';

function editable() {
  const config = defaultConfig();
  for (const map of Object.values(config.maps)) for (const ch of Object.values(map.characters)) delete ch.sprite;
  return config;
}

describe('config validation', () => {
  it('accepts the defaults', () => assert.equal(validateConfig(editable()).ok, true));

  const rejects = (name, mutate) =>
    it(`rejects ${name}`, () => {
      const config = editable();
      mutate(config);
      assert.equal(validateConfig(config).ok, false);
    });

  rejects('an empty name', (c) => { c.maps.grid.characters.player.name = '   '; });
  rejects('an overlong name', (c) => { c.maps.grid.characters.boss.name = 'x'.repeat(33); });
  rejects('control characters', (c) => { c.site.title = 'a\u0007b'; });
  rejects('a bad colour', (c) => { c.site.colors.accent = 'url(evil)'; });
  rejects('an out of range number', (c) => { c.maps.grid.characters.boss.hp = -1; });
  rejects('a non-number', (c) => { c.gameplay.hintSeconds = '2'; });
  rejects('a null number', (c) => { c.gameplay.maxEnemies = null; });
  rejects('a repeated section', (c) => { c.site.mobileOrder = ['game', 'game', 'joystick']; });
  rejects('a missing section', (c) => { c.site.desktopOrder = ['game']; });
  rejects('an unknown key', (c) => { c.site.script = 'x'; });
  rejects('a smuggled sprite', (c) => { c.maps.grid.characters.player.sprite = '../../etc/passwd'; });
  rejects('a stat a role does not have', (c) => { c.maps.grid.characters.hostage.hp = 10; });
  rejects('an invalid choice', (c) => { c.site.titleAlign = 'middle'; });
  rejects('an unknown attack type', (c) => { c.maps.grid.characters.enemy1.attackType = 'laser'; });
  rejects('an attack type on the player', (c) => { c.maps.grid.characters.player.attackType = 'melee'; });
  rejects('a centred joystick', (c) => { c.site.joystickSide = 'center'; });
  rejects('negative XP', (c) => { c.maps.grid.characters.enemy1.xp = -1; });
  rejects('XP on the boss', (c) => { c.maps.grid.characters.boss.xp = 10; });
  rejects('a zero fire rate upgrade', (c) => { c.gameplay.upgradeFireRate = 0; });
  rejects('a zero upgrade threshold', (c) => { c.gameplay.xpToUpgrade = 0; });
  rejects('an unknown map', (c) => { c.maps.moon = c.maps.grid; });
  rejects('a missing map', (c) => { delete c.maps.forest; });
  rejects('an empty map name', (c) => { c.maps.forest.name = ' '; });
  rejects('a bad character on the second map', (c) => { c.maps.forest.characters.enemy5.hp = -1; });
  rejects('a non-boolean switch', (c) => { c.maps.grid.characters.enemy1.enabled = 'yes'; });
  rejects('a switch on the player', (c) => { c.maps.grid.characters.player.enabled = false; });
  rejects('a switch on the hostage', (c) => { c.maps.grid.characters.hostage.enabled = false; });
  rejects('a map with every regular enemy off', (c) => {
    for (const role of ['enemy1', 'enemy2', 'enemy5']) c.maps.forest.characters[role].enabled = false;
  });
  rejects('a negative difficulty increase', (c) => { c.gameplay.difficultyIncrease = -1; });
  rejects('zero kills per difficulty level', (c) => { c.gameplay.difficultyKills = 0; });
  rejects('health on the missile', (c) => { c.maps.grid.characters.missile.hp = 30; });
  rejects('a name on the missile', (c) => { c.maps.grid.characters.missile.name = 'x'; });
  rejects('a name on the ball', (c) => { c.maps.grid.characters.ball.name = 'Ball'; });
  rejects('characters outside a map', (c) => { c.characters = c.maps.grid.characters; });

  it('allows the boss and companion to be off, separately on each map', () => {
    const config = editable();
    config.maps.forest.characters.boss.enabled = false;
    config.maps.forest.characters.companion.enabled = false;
    const { value } = validateConfig(config);
    assert.equal(value.maps.forest.characters.boss.enabled, false);
    assert.equal(value.maps.grid.characters.boss.enabled, true);
  });

  it('trims names', () => {
    const config = editable();
    config.maps.grid.characters.player.name = '  Ada  ';
    assert.equal(validateConfig(config).value.maps.grid.characters.player.name, 'Ada');
  });
});

describe('PNG validation', () => {
  const bad = (name, buffer) => it(`rejects ${name}`, () => assert.throws(() => sanitizePng(buffer()), InvalidPng));

  it('accepts a real PNG', () => assert.ok(sanitizePng(makePng()).length > 0));

  bad('a non-PNG', () => Buffer.from('<svg onload=alert(1)></svg>'.padEnd(64)));
  bad('an empty body', () => Buffer.alloc(0));
  bad('trailing data', () => Buffer.concat([makePng(), Buffer.from('<script>')]));
  bad('a truncated file', () => makePng().subarray(0, 40));
  bad('a corrupted checksum', () => {
    const png = Buffer.from(makePng());
    png[20] ^= 0xff;
    return png;
  });
  bad('huge dimensions', () => makePng(4000, 4));
  bad('undecodable pixels', () => {
    const png = makePng(1, 1);
    const head = png.subarray(0, 33);
    return Buffer.concat([head, chunk('IDAT', Buffer.from('not zlib data')), chunk('IEND', Buffer.alloc(0))]);
  });

  it('strips metadata chunks', () => {
    const clean = sanitizePng(makePng(2, 2, [chunk('tEXt', Buffer.from('Comment\0secret payload'))]));
    assert.equal(clean.includes('secret payload'), false);
    assert.equal(clean.includes('tEXt'), false);
  });
});

describe('admin editing', () => {
  let ctx;
  let auth;
  beforeEach(async () => {
    ctx = await makeApp();
    auth = await signIn(ctx);
  });
  afterEach(() => ctx.close());

  const putConfig = (config, revision = ctx.store.revision) =>
    ctx.app.inject({ method: 'PUT', url: '/api/admin/config', payload: { revision, config }, ...authed(auth) });
  const upload = (role, body, type = 'image/png') =>
    ctx.app.inject({ method: 'PUT', url: `/api/admin/sprites/grid/${role}`, payload: body, ...authed(auth, { headers: { 'content-type': type } }) });
  const publicConfig = async () => (await ctx.app.inject({ url: '/api/config' })).json();

  it('publishes renamed characters and the new title', async () => {
    const config = editable();
    config.maps.grid.characters.boss.name = 'The Keeper';
    config.site.title = 'My Game';
    assert.equal((await putConfig(config)).statusCode, 200);
    const live = await publicConfig();
    assert.equal(live.maps.grid.characters.boss.name, 'The Keeper');
    assert.equal(live.site.title, 'My Game');
  });

  it('rejects invalid config with details', async () => {
    const config = editable();
    config.site.title = '';
    const res = await putConfig(config);
    assert.equal(res.statusCode, 422);
    assert.ok(res.json().details[0].includes('site.title'));
  });

  it('rejects a stale revision', async () => {
    const res = await putConfig(editable(), ctx.store.revision - 1);
    assert.equal(res.statusCode, 409);
  });

  it('serves an uploaded sprite safely and hides the stored hash field', async () => {
    assert.equal((await upload('hostage', makePng())).statusCode, 200);
    const live = await publicConfig();
    assert.match(live.maps.grid.characters.hostage.spriteUrl, /^\/sprites\/[0-9a-f]{64}\.png$/);
    assert.equal('sprite' in live.maps.grid.characters.hostage, false);
    const image = await ctx.app.inject({ url: live.maps.grid.characters.hostage.spriteUrl });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.match(image.headers['content-security-policy'], /sandbox/);
    assert.match(image.headers['cache-control'], /immutable/);
  });

  it('keeps sprites when only text is saved', async () => {
    await upload('player', makePng());
    const before = (await publicConfig()).maps.grid.characters.player.spriteUrl;
    await putConfig(editable());
    assert.equal((await publicConfig()).maps.grid.characters.player.spriteUrl, before);
  });

  it('removes a replaced sprite from disk', async () => {
    await upload('enemy1', makePng(2, 2));
    await upload('enemy1', makePng(3, 3));
    assert.equal(fs.readdirSync(path.join(ctx.dir, 'sprites')).length, 1);
  });

  it('keeps one file when two roles share an image, until neither uses it', async () => {
    await upload('enemy1', makePng());
    await upload('enemy2', makePng());
    assert.equal(fs.readdirSync(path.join(ctx.dir, 'sprites')).length, 1);
    await ctx.app.inject({ method: 'DELETE', url: '/api/admin/sprites/grid/enemy1', ...authed(auth) });
    assert.equal(fs.readdirSync(path.join(ctx.dir, 'sprites')).length, 1);
    await ctx.app.inject({ method: 'DELETE', url: '/api/admin/sprites/grid/enemy2', ...authed(auth) });
    assert.equal(fs.readdirSync(path.join(ctx.dir, 'sprites')).length, 0);
  });

  it('rejects a non-PNG upload', async () => {
    assert.equal((await upload('player', Buffer.from('GIF89a'.padEnd(64)))).statusCode, 422);
  });

  it('rejects the wrong content type', async () => {
    assert.equal((await upload('player', Buffer.from('{"a":1}'), 'application/json')).statusCode, 415);
  });

  it('rejects an oversized upload', async () => {
    assert.equal((await upload('player', Buffer.alloc(MAX_SPRITE_BYTES + 1))).statusCode, 413);
  });

  it('rejects an unknown role', async () => {
    assert.equal((await upload('villain', makePng())).statusCode, 404);
  });

  it('rejects an unknown map', async () => {
    const res = await ctx.app.inject({ method: 'PUT', url: '/api/admin/sprites/moon/player', payload: makePng(), ...authed(auth, { headers: { 'content-type': 'image/png' } }) });
    assert.equal(res.statusCode, 404);
  });

  it('keeps each map\'s characters and images separate', async () => {
    const config = editable();
    config.maps.forest.characters.player.name = 'Only in the forest';
    await putConfig(config);
    const put = await ctx.app.inject({ method: 'PUT', url: '/api/admin/sprites/forest/player', payload: makePng(), ...authed(auth, { headers: { 'content-type': 'image/png' } }) });
    assert.equal(put.statusCode, 200);
    const live = await publicConfig();
    assert.equal(live.maps.forest.characters.player.name, 'Only in the forest');
    assert.notEqual(live.maps.grid.characters.player.name, 'Only in the forest');
    assert.ok(live.maps.forest.characters.player.spriteUrl);
    assert.equal(live.maps.grid.characters.player.spriteUrl, null);
  });

  it('accepts a texture for enemy 5\'s ball', async () => {
    assert.equal((await upload('ball', makePng())).statusCode, 200);
    assert.match((await publicConfig()).maps.grid.characters.ball.spriteUrl, /^\/sprites\//);
  });

  it('keeps an image while another map still uses it', async () => {
    await upload('player', makePng());
    await ctx.app.inject({ method: 'PUT', url: '/api/admin/sprites/forest/boss', payload: makePng(), ...authed(auth, { headers: { 'content-type': 'image/png' } }) });
    await ctx.app.inject({ method: 'DELETE', url: '/api/admin/sprites/grid/player', ...authed(auth) });
    assert.equal(fs.readdirSync(path.join(ctx.dir, 'sprites')).length, 1);
  });

  it('does not serve arbitrary sprite paths', async () => {
    for (const file of ['..%2Fconfig.json', 'abc.png', 'config.json']) {
      assert.equal((await ctx.app.inject({ url: `/sprites/${file}` })).statusCode, 404);
    }
  });

  it('restores defaults and removes sprites', async () => {
    await upload('player', makePng());
    const res = await ctx.app.inject({ method: 'POST', url: '/api/admin/config/reset', payload: {}, ...authed(auth) });
    assert.equal(res.statusCode, 200);
    assert.equal((await publicConfig()).maps.grid.characters.player.spriteUrl, null);
    assert.equal(fs.readdirSync(path.join(ctx.dir, 'sprites')).length, 0);
  });

  it('survives a restart', async () => {
    const config = editable();
    config.site.title = 'Kept';
    await putConfig(config);
    await upload('boss', makePng());
    const reopened = new Store(ctx.dir, { error() {} });
    assert.equal(reopened.publicConfig().site.title, 'Kept');
    assert.ok(reopened.publicConfig().maps.grid.characters.boss.spriteUrl);
  });
});

describe('config upgrades', () => {
  /** A config.json as written before maps, enemy 5, XP, attack types and the second joystick. */
  function flatConfig(edit = () => {}) {
    const { site, gameplay, maps } = defaultConfig();
    const characters = maps.grid.characters;
    delete characters.enemy5;
    delete characters.ball;
    delete characters.jet;
    delete characters.missile;
    for (const ch of Object.values(characters)) delete ch.enabled;
    delete gameplay.jetChance;
    delete gameplay.upgradeFireRate;
    delete gameplay.difficultyKills;
    delete gameplay.difficultyIncrease;
    delete gameplay.enemy5Chance;
    site.joystickSide = 'center';
    site.title = 'Saved title';
    characters.player.name = 'Saved name';
    characters.player.sprite = 'a'.repeat(64);
    edit({ characters, gameplay });
    return { site, gameplay, characters };
  }

  async function reopen(config) {
    const ctx = await makeApp();
    fs.writeFileSync(path.join(ctx.dir, 'config.json'), JSON.stringify({ revision: 7, config }));
    const store = new Store(ctx.dir, { error() {} });
    const state = store.snapshot();
    const corrupt = fs.readdirSync(ctx.dir).some((name) => name.includes('.corrupt-'));
    await ctx.close();
    return { ...state, corrupt };
  }

  it('moves an older config\'s edits and images onto the first map', async () => {
    const { revision, config, corrupt } = await reopen(flatConfig());
    assert.equal(corrupt, false);
    assert.equal(revision, 7);
    assert.equal(config.site.title, 'Saved title');
    assert.equal(config.site.joystickSide, 'left');
    const { player, enemy5, ball } = config.maps.grid.characters;
    assert.equal(player.name, 'Saved name');
    assert.equal(player.sprite, 'a'.repeat(64));
    assert.equal(enemy5.fireInterval, 3);
    assert.equal(enemy5.enabled, true);
    assert.equal(ball.sprite, null);
    assert.equal(config.gameplay.enemy5Chance, defaultConfig().gameplay.enemy5Chance);
  });

  it('gives the new map its own default cast, without the old images', async () => {
    const { config } = await reopen(flatConfig());
    assert.equal(config.maps.forest.characters.player.sprite, null);
    assert.equal(config.maps.forest.characters.player.name, defaultConfig().maps.forest.characters.player.name);
  });

  it('fills fields missing from older configs', async () => {
    const { config } = await reopen(flatConfig(({ characters, gameplay }) => {
      for (const role of ['enemy1', 'enemy2', 'boss']) delete characters[role].attackType;
      delete characters.enemy1.xp;
      delete characters.enemy2.xp;
      delete gameplay.xpToUpgrade;
      delete gameplay.upgradeDamage;
      delete gameplay.upgradeHealth;
    }));
    const { enemy1, enemy2, boss } = config.maps.grid.characters;
    assert.equal(enemy1.attackType, 'melee');
    assert.equal(boss.attackType, 'pump');
    assert.equal(enemy1.xp, 40);
    assert.equal(enemy2.xp, 10);
    assert.equal(config.gameplay.xpToUpgrade, 200);
  });

  it('swaps the old 10 and 40 XP defaults so the stronger enemy pays more', async () => {
    const { config } = await reopen(flatConfig(({ characters }) => {
      characters.enemy1.xp = 10;
      characters.enemy2.xp = 40;
    }));
    assert.equal(config.maps.grid.characters.enemy1.xp, 40);
    assert.equal(config.maps.grid.characters.enemy2.xp, 10);
  });

  it('leaves XP values the admin chose', async () => {
    const { config } = await reopen(flatConfig(({ characters }) => {
      characters.enemy1.xp = 77;
      characters.enemy2.xp = 5;
    }));
    assert.equal(config.maps.grid.characters.enemy1.xp, 77);
    assert.equal(config.maps.grid.characters.enemy2.xp, 5);
  });

  it('drops the missile health setting saved by earlier versions, keeping everything else', async () => {
    const stored = defaultConfig();
    stored.maps.grid.characters.missile.hp = 30;
    stored.maps.grid.characters.missile.damage = 77;
    const { config, corrupt } = await reopen(stored);
    assert.equal(corrupt, false);
    assert.equal(config.maps.grid.characters.missile.damage, 77);
    assert.equal('hp' in config.maps.grid.characters.missile, false);
  });

  it('does not swap XP again once the config has maps', async () => {
    const stored = defaultConfig();
    stored.maps.grid.characters.enemy1.xp = 10;
    stored.maps.grid.characters.enemy2.xp = 40;
    const { config } = await reopen(stored);
    assert.equal(config.maps.grid.characters.enemy1.xp, 10);
    for (const mapId of MAPS) assert.ok(config.maps[mapId].name);
  });
});

describe('store recovery', () => {
  it('moves a corrupt file aside instead of crashing', async () => {
    const ctx = await makeApp();
    fs.writeFileSync(path.join(ctx.dir, 'config.json'), '{not json');
    const store = new Store(ctx.dir, { error() {} });
    assert.equal(store.publicConfig().site.title, defaultConfig().site.title);
    assert.ok(fs.readdirSync(ctx.dir).some((name) => name.includes('.corrupt-')));
    await ctx.close();
  });
});
