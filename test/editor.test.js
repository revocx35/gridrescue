import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { defaultConfig, validateConfig } from '../public/js/schema.js';
import { InvalidPng, MAX_SPRITE_BYTES, sanitizePng } from '../src/png.js';
import { Store } from '../src/store.js';
import { authed, chunk, makeApp, makePng, signIn } from './helpers.js';

function editable() {
  const config = defaultConfig();
  for (const ch of Object.values(config.characters)) delete ch.sprite;
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

  rejects('an empty name', (c) => { c.characters.player.name = '   '; });
  rejects('an overlong name', (c) => { c.characters.boss.name = 'x'.repeat(33); });
  rejects('control characters', (c) => { c.site.title = 'a\u0007b'; });
  rejects('a bad colour', (c) => { c.site.colors.accent = 'url(evil)'; });
  rejects('an out of range number', (c) => { c.characters.boss.hp = -1; });
  rejects('a non-number', (c) => { c.gameplay.hintSeconds = '2'; });
  rejects('a null number', (c) => { c.gameplay.maxEnemies = null; });
  rejects('a repeated section', (c) => { c.site.mobileOrder = ['game', 'game', 'joystick']; });
  rejects('a missing section', (c) => { c.site.desktopOrder = ['game']; });
  rejects('an unknown key', (c) => { c.site.script = 'x'; });
  rejects('a smuggled sprite', (c) => { c.characters.player.sprite = '../../etc/passwd'; });
  rejects('a stat a role does not have', (c) => { c.characters.hostage.hp = 10; });
  rejects('an invalid choice', (c) => { c.site.titleAlign = 'middle'; });
  rejects('an unknown attack type', (c) => { c.characters.enemy1.attackType = 'laser'; });
  rejects('an attack type on the player', (c) => { c.characters.player.attackType = 'melee'; });
  rejects('a centred joystick', (c) => { c.site.joystickSide = 'center'; });

  it('trims names', () => {
    const config = editable();
    config.characters.player.name = '  Ada  ';
    assert.equal(validateConfig(config).value.characters.player.name, 'Ada');
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
    ctx.app.inject({ method: 'PUT', url: `/api/admin/sprites/${role}`, payload: body, ...authed(auth, { headers: { 'content-type': type } }) });
  const publicConfig = async () => (await ctx.app.inject({ url: '/api/config' })).json();

  it('publishes renamed characters and the new title', async () => {
    const config = editable();
    config.characters.boss.name = 'The Keeper';
    config.site.title = 'My Game';
    assert.equal((await putConfig(config)).statusCode, 200);
    const live = await publicConfig();
    assert.equal(live.characters.boss.name, 'The Keeper');
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
    assert.match(live.characters.hostage.spriteUrl, /^\/sprites\/[0-9a-f]{64}\.png$/);
    assert.equal('sprite' in live.characters.hostage, false);
    const image = await ctx.app.inject({ url: live.characters.hostage.spriteUrl });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.match(image.headers['content-security-policy'], /sandbox/);
    assert.match(image.headers['cache-control'], /immutable/);
  });

  it('keeps sprites when only text is saved', async () => {
    await upload('player', makePng());
    const before = (await publicConfig()).characters.player.spriteUrl;
    await putConfig(editable());
    assert.equal((await publicConfig()).characters.player.spriteUrl, before);
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
    await ctx.app.inject({ method: 'DELETE', url: '/api/admin/sprites/enemy1', ...authed(auth) });
    assert.equal(fs.readdirSync(path.join(ctx.dir, 'sprites')).length, 1);
    await ctx.app.inject({ method: 'DELETE', url: '/api/admin/sprites/enemy2', ...authed(auth) });
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

  it('does not serve arbitrary sprite paths', async () => {
    for (const file of ['..%2Fconfig.json', 'abc.png', 'config.json']) {
      assert.equal((await ctx.app.inject({ url: `/sprites/${file}` })).statusCode, 404);
    }
  });

  it('restores defaults and removes sprites', async () => {
    await upload('player', makePng());
    const res = await ctx.app.inject({ method: 'POST', url: '/api/admin/config/reset', payload: {}, ...authed(auth) });
    assert.equal(res.statusCode, 200);
    assert.equal((await publicConfig()).characters.player.spriteUrl, null);
    assert.equal(fs.readdirSync(path.join(ctx.dir, 'sprites')).length, 0);
  });

  it('survives a restart', async () => {
    const config = editable();
    config.site.title = 'Kept';
    await putConfig(config);
    await upload('boss', makePng());
    const reopened = new Store(ctx.dir, { error() {} });
    assert.equal(reopened.publicConfig().site.title, 'Kept');
    assert.ok(reopened.publicConfig().characters.boss.spriteUrl);
  });
});

describe('config upgrades', () => {
  it('keeps edits and sprites from a config saved before attack types and the second joystick', async () => {
    const ctx = await makeApp();
    const old = defaultConfig();
    for (const role of ['enemy1', 'enemy2', 'boss']) delete old.characters[role].attackType;
    old.site.joystickSide = 'center';
    old.site.title = 'Saved title';
    old.characters.player.name = 'Saved name';
    old.characters.player.sprite = 'a'.repeat(64);
    fs.writeFileSync(path.join(ctx.dir, 'config.json'), JSON.stringify({ revision: 7, config: old }));
    const store = new Store(ctx.dir, { error() {} });
    const { revision, config } = store.snapshot();
    assert.equal(revision, 7);
    assert.equal(config.site.title, 'Saved title');
    assert.equal(config.site.joystickSide, 'left');
    assert.equal(config.characters.player.name, 'Saved name');
    assert.equal(config.characters.player.sprite, 'a'.repeat(64));
    assert.equal(config.characters.enemy1.attackType, 'melee');
    assert.equal(config.characters.boss.attackType, 'pump');
    assert.equal(fs.readdirSync(ctx.dir).some((name) => name.includes('.corrupt-')), false);
    await ctx.close();
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
