import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MAX_SOUND_BYTES, defaultConfig } from '../public/js/schema.js';
import { InvalidAudio, sanitizeAudio } from '../src/audio.js';
import { Store } from '../src/store.js';
import { ORIGIN, authed, makeApp, signIn } from './helpers.js';

function makeWav({ channels = 1, rate = 8000, bits = 16, samples = 8, code = 1, extra = Buffer.alloc(0), trailing = Buffer.alloc(0) } = {}) {
  const align = (channels * bits) / 8;
  const data = Buffer.alloc(samples * align, 0x11);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(code, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * align, 8);
  fmt.writeUInt16LE(align, 12);
  fmt.writeUInt16LE(bits, 14);
  const chunk = (id, body) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'latin1');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, Buffer.alloc(body.length % 2)]);
  };
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), chunk('fmt ', fmt), extra.length ? chunk('LIST', extra) : Buffer.alloc(0), chunk('data', data), trailing]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Valid MPEG1 Layer III frames at 128 kbps, 44.1 kHz: 417 bytes each. */
function mp3Frames(count) {
  const frame = Buffer.alloc(417, 0x55);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat(Array(count).fill(frame));
}

function id3(payload = Buffer.alloc(30, 0x41)) {
  const head = Buffer.alloc(10);
  head.write('ID3', 0, 'latin1');
  head[3] = 3;
  const n = payload.length;
  head.set([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f], 6);
  return Buffer.concat([head, payload]);
}

describe('audio sanitiser', () => {
  const rejected = (type, buffer) => assert.throws(() => sanitizeAudio(type, buffer), InvalidAudio);

  it('rebuilds a wav with only format and data', () => {
    const secret = Buffer.from('<script>evil()</script>', 'latin1');
    const { bytes, extension } = sanitizeAudio('audio/wav', makeWav({ extra: secret, trailing: Buffer.from('AFTER-THE-END') }));
    assert.equal(extension, 'wav');
    assert.equal(bytes.length, 44 + 16);
    assert.equal(bytes.includes(secret), false);
    assert.equal(bytes.includes(Buffer.from('AFTER-THE-END')), false);
  });

  it('keeps stereo and common bit depths', () => {
    for (const options of [{ channels: 2 }, { bits: 8 }, { bits: 24 }, { rate: 44100 }]) {
      assert.ok(sanitizeAudio('audio/wav', makeWav(options)).bytes.length > 44);
    }
  });

  it('rejects broken or unusual wavs', () => {
    rejected('audio/wav', Buffer.from('not audio at all'));
    rejected('audio/wav', Buffer.alloc(0));
    rejected('audio/wav', makeWav({ code: 3 }));
    rejected('audio/wav', makeWav({ channels: 6 }));
    rejected('audio/wav', makeWav({ rate: 200000 }));
    rejected('audio/wav', makeWav({ bits: 13 }));
    rejected('audio/wav', makeWav({ samples: 0 }));
    const lying = makeWav();
    lying.writeUInt32LE(0xffffff, 16);
    rejected('audio/wav', lying);
  });

  it('strips tags and trailing bytes from an mp3', () => {
    const frames = mp3Frames(3);
    const { bytes, extension } = sanitizeAudio('audio/mpeg', Buffer.concat([id3(), frames, Buffer.from('TAG trailing payload')]));
    assert.equal(extension, 'mp3');
    assert.deepEqual(bytes, frames);
  });

  it('rejects something that is not an mp3', () => {
    rejected('audio/mpeg', Buffer.from('<html>definitely not</html>'));
    rejected('audio/mpeg', Buffer.alloc(0));
    rejected('audio/mpeg', mp3Frames(1));
    rejected('audio/mpeg', Buffer.concat([id3(), Buffer.alloc(40)]));
    const reservedRate = mp3Frames(3);
    reservedRate[2] = 0x9c;
    rejected('audio/mpeg', reservedRate);
  });

  it('rejects an unknown type', () => rejected('audio/flac', makeWav()));
});

describe('sound uploads', () => {
  let ctx;
  let auth;
  beforeEach(async () => {
    ctx = await makeApp();
    auth = await signIn(ctx);
  });
  afterEach(() => ctx.close());

  const put = (target, body, type = 'audio/wav', credentials = auth) => ctx.app.inject({
    method: 'PUT', url: `/api/admin/sounds/${target}`, payload: body,
    ...authed(credentials, { headers: { 'content-type': type } }),
  });
  const del = (target, credentials = auth) => ctx.app.inject({ method: 'DELETE', url: `/api/admin/sounds/${target}`, ...authed(credentials) });
  const live = async () => (await ctx.app.inject({ url: '/api/config' })).json();
  const soundFiles = () => fs.readdirSync(path.join(ctx.dir, 'sounds'));

  it('has no sounds by default', async () => {
    const { maps } = await live();
    for (const map of Object.values(maps)) for (const ch of Object.values(map.characters)) assert.deepEqual(ch.soundUrls, {});
  });

  it('serves an uploaded sound safely and hides the stored name', async () => {
    assert.equal((await put('grid/enemy1/idle', makeWav())).statusCode, 200);
    const config = await live();
    const url = config.maps.grid.characters.enemy1.soundUrls.idle;
    assert.match(url, /^\/sounds\/[0-9a-f]{64}\.wav$/);
    assert.equal('sounds' in config.maps.grid.characters.enemy1, false);
    const res = await ctx.app.inject({ url });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /^audio\/wav/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'], /sandbox/);
  });

  it('accepts mp3 and serves it with its own type', async () => {
    assert.equal((await put('forest/boss/theme', mp3Frames(4), 'audio/mpeg')).statusCode, 200);
    const url = (await live()).maps.forest.characters.boss.soundUrls.theme;
    assert.match(url, /\.mp3$/);
    assert.match((await ctx.app.inject({ url })).headers['content-type'], /^audio\/mpeg/);
  });

  it('keeps maps separate', async () => {
    await put('forest/player/shoot', makeWav());
    const { maps } = await live();
    assert.ok(maps.forest.characters.player.soundUrls.shoot);
    assert.equal(maps.grid.characters.player.soundUrls.shoot, undefined);
  });

  it('rejects slots a role does not have', async () => {
    for (const target of ['grid/enemy1/theme', 'grid/boss/idle', 'grid/ball/idle', 'grid/enemy5/impact', 'grid/player/nope', 'moon/player/shoot', 'grid/rocketeer/idle']) {
      assert.equal((await put(target, makeWav())).statusCode, 404, target);
    }
    assert.equal((await put('wasteland/rocketeer/idle', makeWav())).statusCode, 200);
  });

  it('rejects bytes that are not audio, a wrong type and an oversized body', async () => {
    assert.equal((await put('grid/enemy1/idle', Buffer.from('nope'))).statusCode, 422);
    assert.equal((await put('grid/enemy1/idle', makeWav(), 'text/html')).statusCode, 415);
    assert.equal((await put('grid/enemy1/idle', Buffer.alloc(MAX_SOUND_BYTES + 1))).statusCode, 413);
    assert.equal(soundFiles().length, 0);
  });

  it('needs a session, a CSRF token and the right origin', async () => {
    const url = '/api/admin/sounds/grid/enemy1/idle';
    const headers = { 'content-type': 'audio/wav' };
    assert.equal((await ctx.app.inject({ method: 'PUT', url, payload: makeWav(), headers: { ...headers, origin: ORIGIN } })).statusCode, 401);
    assert.equal((await put('grid/enemy1/idle', makeWav(), 'audio/wav', { ...auth, csrf: 'wrong' })).statusCode, 403);
    assert.equal((await ctx.app.inject({
      method: 'PUT', url, payload: makeWav(),
      ...authed(auth, { headers: { ...headers, origin: 'https://evil.example.test' } }),
    })).statusCode, 403);
    assert.equal((await ctx.app.inject({ method: 'DELETE', url, headers: { origin: ORIGIN } })).statusCode, 401);
    assert.equal((await del('grid/enemy1/idle', { ...auth, csrf: 'wrong' })).statusCode, 403);
  });

  it('removes a replaced or deleted sound from disk, and shares identical files', async () => {
    await put('grid/enemy1/idle', makeWav());
    await put('grid/enemy2/idle', makeWav());
    assert.equal(soundFiles().length, 1);
    await put('grid/enemy1/idle', makeWav({ samples: 9 }));
    assert.equal(soundFiles().length, 2);
    await del('grid/enemy1/idle');
    assert.equal(soundFiles().length, 1);
    await del('grid/enemy2/idle');
    assert.equal(soundFiles().length, 0);
  });

  it('keeps sounds through a text save, and rejects a config carrying them', async () => {
    await put('grid/enemy1/idle', makeWav());
    const { config, revision } = ctx.store.snapshot();
    const save = (body) => ctx.app.inject({ method: 'PUT', url: '/api/admin/config', payload: body, ...authed(auth) });
    const smuggled = await save({ revision, config });
    assert.equal(smuggled.statusCode, 422);
    for (const map of Object.values(config.maps)) for (const ch of Object.values(map.characters)) { delete ch.sprite; delete ch.sounds; }
    config.site.title = 'Changed';
    assert.equal((await save({ revision, config })).statusCode, 200);
    assert.ok((await live()).maps.grid.characters.enemy1.soundUrls.idle);
  });

  it('restores defaults by deleting every sound', async () => {
    await put('grid/enemy1/idle', makeWav());
    await ctx.app.inject({ method: 'POST', url: '/api/admin/config/reset', payload: {}, ...authed(auth) });
    assert.equal(soundFiles().length, 0);
    assert.deepEqual((await live()).maps.grid.characters.enemy1.soundUrls, {});
  });

  it('does not serve arbitrary sound paths', async () => {
    for (const file of ['..%2f..%2fconfig.json', 'a.wav', `${'a'.repeat(64)}.exe`, `${'a'.repeat(64)}.wav`]) {
      assert.equal((await ctx.app.inject({ url: `/sounds/${file}` })).statusCode, 404);
    }
  });

  it('survives a restart', async () => {
    await put('grid/enemy1/idle', makeWav());
    const reopened = new Store(ctx.dir, { error() {} });
    assert.ok(reopened.publicConfig().maps.grid.characters.enemy1.soundUrls.idle);
  });

  it('drops a stored sound name that is not well formed', () => {
    const stored = ctx.store.snapshot();
    stored.config.maps.grid.characters.enemy1.sounds = { idle: '../../evil', shoot: `${'a'.repeat(64)}.mp3`, theme: `${'b'.repeat(64)}.wav` };
    fs.writeFileSync(path.join(ctx.dir, 'config.json'), JSON.stringify(stored));
    const reopened = new Store(ctx.dir, { error() {} });
    assert.deepEqual(reopened.snapshot().config.maps.grid.characters.enemy1.sounds, { shoot: `${'a'.repeat(64)}.mp3` });
  });

  it('moves shared spawn settings onto every map', () => {
    const stored = ctx.store.snapshot();
    for (const map of Object.values(stored.config.maps)) delete map.spawns;
    Object.assign(stored.config.gameplay, { spawnInterval: 0.5, maxEnemies: 50, enemy1Chance: 0.3, enemy5Chance: 0.1, jetChance: 0.2, bossChance: 0.04 });
    fs.writeFileSync(path.join(ctx.dir, 'config.json'), JSON.stringify(stored));
    const { config } = new Store(ctx.dir, { error() {} }).snapshot();
    assert.equal(fs.readdirSync(ctx.dir).some((name) => name.includes('.corrupt-')), false);
    for (const map of Object.values(config.maps)) {
      assert.equal(map.spawns.spawnInterval, 0.5);
      assert.equal(map.spawns.maxEnemies, 50);
      assert.equal(map.spawns.bossChance, 0.04);
    }
    assert.equal(config.maps.wasteland.spawns.busChance, defaultConfig().maps.wasteland.spawns.busChance);
    assert.equal('spawnInterval' in config.gameplay, false);
    assert.equal('busChance' in config.maps.grid.spawns, false);
  });

  it('keeps each map\'s spawn settings through a save and a restart', async () => {
    const { config, revision } = ctx.store.snapshot();
    for (const map of Object.values(config.maps)) for (const ch of Object.values(map.characters)) { delete ch.sprite; delete ch.sounds; }
    config.maps.forest.spawns.spawnInterval = 3;
    config.maps.wasteland.spawns.busChance = 0.5;
    const res = await ctx.app.inject({ method: 'PUT', url: '/api/admin/config', payload: { revision, config }, ...authed(auth) });
    assert.equal(res.statusCode, 200);
    const reopened = new Store(ctx.dir, { error() {} }).publicConfig();
    assert.equal(reopened.maps.forest.spawns.spawnInterval, 3);
    assert.equal(reopened.maps.grid.spawns.spawnInterval, defaultConfig().maps.grid.spawns.spawnInterval);
    assert.equal(reopened.maps.wasteland.spawns.busChance, 0.5);
  });

  it('adds the new map to a config saved before it existed', () => {
    const stored = ctx.store.snapshot();
    delete stored.config.maps.wasteland;
    for (const map of Object.values(stored.config.maps)) delete map.spawns;
    delete stored.config.maps.grid.characters.boss.endlessXp;
    fs.writeFileSync(path.join(ctx.dir, 'config.json'), JSON.stringify(stored));
    const { config } = new Store(ctx.dir, { error() {} }).snapshot();
    assert.deepEqual(config.maps.wasteland.signs, defaultConfig().maps.wasteland.signs);
    assert.equal(config.maps.grid.spawns.bossChance, defaultConfig().maps.grid.spawns.bossChance);
    assert.equal(config.maps.grid.characters.boss.endlessXp, defaultConfig().maps.grid.characters.boss.endlessXp);
    assert.equal('rocketeer' in config.maps.grid.characters, false);
  });
});

describe('endless leaderboard', () => {
  let ctx;
  beforeEach(async () => { ctx = await makeApp(); });
  afterEach(() => ctx.close());

  const start = async (body) => (await ctx.app.inject({ method: 'POST', url: '/api/runs', payload: body })).json().token;
  const score = (body) => ctx.app.inject({ method: 'POST', url: '/api/leaderboard', payload: body });
  const board = async () => (await ctx.app.inject({ url: '/api/leaderboard' })).json().maps.grid;

  it('rejects an unknown mode', async () => {
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/runs', payload: { map: 'grid', mode: 'cheat' } })).statusCode, 400);
  });

  it('defaults to a rescue run', async () => {
    const token = await start({ map: 'grid' });
    ctx.advance(200_000);
    assert.equal((await score({ token, name: 'Ada', time: 190, kills: 20, won: true })).statusCode, 200);
    assert.equal((await board()).fastest.length, 1);
    assert.equal((await board()).endlessKills.length, 0);
  });

  it('keeps Endless scores on their own rankings', async () => {
    const token = await start({ map: 'grid', mode: 'endless' });
    ctx.advance(200_000);
    assert.equal((await score({ token, name: 'Grace', time: 190, kills: 200, won: false })).statusCode, 200);
    const result = await board();
    assert.equal(result.kills.length, 0);
    assert.equal(result.fastest.length, 0);
    assert.equal(result.endlessKills[0].name, 'Grace');
    assert.equal(result.endlessTime[0].time, 190);
  });

  it('takes the mode from the token, not the request', async () => {
    const token = await start({ map: 'grid', mode: 'endless' });
    ctx.advance(200_000);
    await score({ token, name: 'Grace', time: 190, kills: 5, won: false, mode: 'rescue' });
    assert.equal((await board()).endlessKills.length, 1);
  });

  it('refuses a win in Endless, and a run with no kills', async () => {
    const won = await start({ map: 'grid', mode: 'endless' });
    const empty = await start({ map: 'grid', mode: 'endless' });
    ctx.advance(200_000);
    assert.equal((await score({ token: won, name: 'A', time: 190, kills: 5, won: true })).statusCode, 403);
    assert.equal((await score({ token: empty, name: 'A', time: 190, kills: 0, won: false })).statusCode, 403);
  });

  it('accepts runs on the wasteland', async () => {
    const token = await start({ map: 'wasteland', mode: 'endless' });
    ctx.advance(20_000);
    assert.equal((await score({ token, name: 'Ada', time: 15, kills: 3, won: false })).statusCode, 200);
  });
});
