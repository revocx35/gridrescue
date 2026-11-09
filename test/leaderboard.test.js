import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Leaderboard, RUN_TTL_MS } from '../src/leaderboard.js';
import { cleanScoreName, defaultConfig, mapConfig } from '../public/js/schema.js';
import { scoreLimits } from '../public/js/sim.js';
import { ORIGIN, authed, makeApp, signIn } from './helpers.js';

const limits = scoreLimits(mapConfig(defaultConfig(), 'grid'));
const GOOD_TIME = Math.ceil(limits.minTime) + 30;

describe('leaderboard', () => {
  let ctx;
  beforeEach(async () => { ctx = await makeApp(); });
  afterEach(() => ctx.close());

  const newRun = async (map = 'grid') =>
    (await ctx.app.inject({ method: 'POST', url: '/api/runs', payload: { map } })).json().token;
  const post = (payload) => ctx.app.inject({ method: 'POST', url: '/api/leaderboard', payload });
  const board = async () => (await ctx.app.inject({ url: '/api/leaderboard' })).json();

  /** Starts a run, lets the seconds pass, and posts a score for it. */
  async function play({ name = 'Ada', time = GOOD_TIME, kills = 20, map = 'grid' } = {}) {
    const token = await newRun(map);
    ctx.advance(time * 1000);
    return post({ token, name, time, kills });
  }

  it('adds a finished run and shows it', async () => {
    const res = await play();
    assert.equal(res.statusCode, 200);
    const { fastest, kills } = (await board()).maps.grid;
    assert.equal(fastest[0].name, 'Ada');
    assert.equal(kills[0].kills, 20);
    assert.equal(fastest[0].id, res.json().entry.id);
  });

  it('ranks by shortest time and by most kills separately', async () => {
    await play({ name: 'Quick', time: GOOD_TIME, kills: 5 });
    await play({ name: 'Slayer', time: GOOD_TIME + 60, kills: 90 });
    const { fastest, kills } = (await board()).maps.grid;
    assert.deepEqual(fastest.map((e) => e.name), ['Quick', 'Slayer']);
    assert.deepEqual(kills.map((e) => e.name), ['Slayer', 'Quick']);
  });

  it('keeps each map separate, taking the map from the run rather than the request', async () => {
    const token = await newRun('forest');
    ctx.advance(GOOD_TIME * 1000);
    assert.equal((await post({ token, name: 'Ada', time: GOOD_TIME, kills: 3, map: 'grid' })).statusCode, 200);
    const { maps } = await board();
    assert.equal(maps.grid.fastest.length, 0);
    assert.equal(maps.forest.fastest.length, 1);
  });

  it('shows at most ten per ranking but keeps a runner-up ranking in each', async () => {
    for (let i = 0; i < 12; i++) await play({ name: `P${i}`, time: GOOD_TIME + i, kills: i });
    const { fastest, kills } = (await board()).maps.grid;
    assert.equal(fastest.length, 10);
    assert.equal(kills.length, 10);
    assert.equal(kills[0].name, 'P11');
  });

  it('stores a bounded number of entries however many are posted', async () => {
    for (let i = 0; i < 130; i++) ctx.leaderboard.add('grid', { name: 'x', time: 100 + i, kills: i });
    assert.ok(ctx.leaderboard.maps.grid.length <= 100);
    assert.equal(ctx.leaderboard.view().maps.grid.fastest[0].time, 100);
    assert.equal(ctx.leaderboard.view().maps.grid.kills[0].kills, 129);
  });

  it('survives a restart', async () => {
    await play();
    const reopened = new Leaderboard(ctx.dir, { error() {} });
    assert.equal(reopened.view().maps.grid.fastest[0].name, 'Ada');
  });

  it('moves a corrupt file aside instead of crashing', () => {
    fs.writeFileSync(path.join(ctx.dir, 'leaderboard.json'), '{nope');
    const reopened = new Leaderboard(ctx.dir, { error() {} });
    assert.equal(reopened.view().maps.grid.fastest.length, 0);
    assert.ok(fs.readdirSync(ctx.dir).some((file) => file.includes('.corrupt-')));
  });

  it('accepts one score per run', async () => {
    const token = await newRun();
    ctx.advance(GOOD_TIME * 1000);
    assert.equal((await post({ token, name: 'Ada', time: GOOD_TIME, kills: 1 })).statusCode, 200);
    assert.equal((await post({ token, name: 'Ada', time: GOOD_TIME, kills: 1 })).statusCode, 403);
  });

  it('rejects a made-up token', async () => {
    assert.equal((await post({ token: 'nope', name: 'Ada', time: GOOD_TIME, kills: 1 })).statusCode, 403);
  });

  it('rejects a missing token', async () => {
    assert.equal((await post({ name: 'Ada', time: GOOD_TIME, kills: 1 })).statusCode, 403);
  });

  it('rejects an expired run', async () => {
    const token = await newRun();
    ctx.advance(RUN_TTL_MS + 1000);
    assert.equal((await post({ token, name: 'Ada', time: GOOD_TIME, kills: 1 })).statusCode, 403);
  });

  it('rejects a time faster than walking to the hostage allows', async () => {
    assert.equal((await play({ time: limits.minTime - 1 })).statusCode, 403);
  });

  it('rejects a time longer than the run has really been going', async () => {
    const token = await newRun();
    ctx.advance(10_000);
    assert.equal((await post({ token, name: 'Ada', time: GOOD_TIME, kills: 1 })).statusCode, 403);
  });

  it('accepts a run that was paused, so took longer than its game time', async () => {
    const token = await newRun();
    ctx.advance((GOOD_TIME + 600) * 1000);
    assert.equal((await post({ token, name: 'Ada', time: GOOD_TIME, kills: 1 })).statusCode, 200);
  });

  it('rejects more kills than enemies could have spawned', async () => {
    assert.equal((await play({ kills: 100_000 })).statusCode, 403);
  });

  for (const [label, time, kills] of [
    ['text time', 'fast', 1], ['null time', null, 1], ['negative kills', GOOD_TIME, -1],
    ['fractional kills', GOOD_TIME, 1.5], ['text kills', GOOD_TIME, '9'],
  ]) {
    it(`rejects ${label}`, async () => {
      const token = await newRun();
      ctx.advance(GOOD_TIME * 1000);
      assert.equal((await post({ token, name: 'Ada', time, kills })).statusCode, 403);
    });
  }

  it('lets the player fix a rejected name without losing the run', async () => {
    const token = await newRun();
    ctx.advance(GOOD_TIME * 1000);
    assert.equal((await post({ token, name: ' ', time: GOOD_TIME, kills: 1 })).statusCode, 422);
    assert.equal((await post({ token, name: 'Ada', time: GOOD_TIME, kills: 1 })).statusCode, 200);
  });

  it('stores markup as plain text', async () => {
    await play({ name: '<img src=x>' });
    assert.equal((await board()).maps.grid.fastest[0].name, '<img src=x>');
  });

  it('rejects an unknown map when starting a run', async () => {
    for (const map of ['moon', '__proto__', null]) {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/runs', payload: { map } });
      assert.equal(res.statusCode, 400);
    }
  });

  it('rejects an oversized score', async () => {
    assert.equal((await post({ token: 'x'.repeat(5000), name: 'Ada', time: 1, kills: 1 })).statusCode, 413);
  });

  it('rejects non-JSON bodies', async () => {
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/leaderboard', payload: 'name=Ada', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(res.statusCode, 415);
  });

  it('rate limits scores per address', async () => {
    const limited = await makeApp({ rateLimits: { score: 2 } });
    const send = () => limited.app.inject({ method: 'POST', url: '/api/leaderboard', payload: { name: 'A' } });
    await send();
    await send();
    assert.equal((await send()).statusCode, 429);
    await limited.close();
  });

  describe('name rules', () => {
    it('trims', () => assert.equal(cleanScoreName('  Ada '), 'Ada'));
    it('allows non-Latin names', () => assert.equal(cleanScoreName('Kerem Öz 🙂'), 'Kerem Öz 🙂'));
    for (const [label, value] of [
      ['empty', '   '], ['too long', 'x'.repeat(21)], ['a control character', 'a\u0007b'], ['a newline', 'a\nb'],
      ['a zero-width space', 'a​b'], ['a direction override', 'a‮b'], ['a number', 5], ['null', null],
    ]) {
      it(`rejects ${label}`, () => assert.equal(cleanScoreName(value), null));
    }
  });

  describe('admin moderation', () => {
    let auth;
    beforeEach(async () => { auth = await signIn(ctx); });
    const remove = (url, extra = authed(auth)) => ctx.app.inject({ method: 'DELETE', url, ...extra });

    it('lists every entry', async () => {
      await play();
      const res = await ctx.app.inject({ url: '/api/admin/leaderboard', ...authed(auth) });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().maps.grid.length, 1);
    });

    it('deletes one entry', async () => {
      const { entry } = (await play()).json();
      assert.equal((await remove(`/api/admin/leaderboard/grid/${entry.id}`)).statusCode, 200);
      assert.equal((await board()).maps.grid.fastest.length, 0);
    });

    it('clears one map only', async () => {
      await play();
      await play({ map: 'forest' });
      assert.equal((await remove('/api/admin/leaderboard/grid')).statusCode, 200);
      const { maps } = await board();
      assert.equal(maps.grid.fastest.length, 0);
      assert.equal(maps.forest.fastest.length, 1);
    });

    it('404s an unknown entry or map', async () => {
      assert.equal((await remove('/api/admin/leaderboard/grid/none')).statusCode, 404);
      assert.equal((await remove('/api/admin/leaderboard/moon')).statusCode, 404);
    });

    it('requires a session to list or delete', async () => {
      assert.equal((await ctx.app.inject({ url: '/api/admin/leaderboard' })).statusCode, 401);
      const { entry } = (await play()).json();
      assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/admin/leaderboard/grid/${entry.id}` })).statusCode, 401);
      assert.equal((await board()).maps.grid.fastest.length, 1);
    });

    it('requires CSRF and the right origin to delete', async () => {
      const { entry } = (await play()).json();
      const url = `/api/admin/leaderboard/grid/${entry.id}`;
      const cookies = { '__Host-gr_session': auth.cookie };
      assert.equal((await remove(url, { cookies, headers: { origin: ORIGIN } })).statusCode, 403);
      assert.equal((await remove(url, { cookies, headers: { origin: 'https://evil.example', 'x-csrf-token': auth.csrf } })).statusCode, 403);
      assert.equal((await board()).maps.grid.fastest.length, 1);
    });
  });
});
