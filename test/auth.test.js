import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../src/sessions.js';
import { ORIGIN, authed, cookiesOf, makeApp, signIn } from './helpers.js';

describe('admin sign-in', () => {
  let ctx;
  beforeEach(async () => { ctx = await makeApp(); });
  afterEach(() => ctx.close());

  it('sends an admin through the provider and creates a session', async () => {
    const auth = await signIn(ctx);
    assert.equal(auth.callback.statusCode, 302);
    assert.equal(auth.callback.headers.location, '/admin');
    assert.ok(auth.cookie);
    assert.ok(auth.csrf);
  });

  it('marks cookies __Host-, Secure, HttpOnly and Lax', async () => {
    const auth = await signIn(ctx);
    const cookie = cookiesOf(auth.callback)['__Host-gr_session'];
    assert.equal(cookie.secure, true);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Lax');
    assert.equal(cookie.path, '/');
  });

  it('rejects an unknown state', async () => {
    const res = await ctx.app.inject({ url: '/auth/callback?code=a&state=nope', cookies: { '__Host-gr_login': 'x' } });
    assert.equal(res.headers.location, '/admin?error=denied');
    assert.equal(cookiesOf(res)['__Host-gr_session'], undefined);
  });

  it('rejects a callback from a different browser', async () => {
    const login = await ctx.app.inject({ url: '/auth/login' });
    const state = new URL(login.headers.location).searchParams.get('state');
    const res = await ctx.app.inject({ url: `/auth/callback?code=a&state=${state}`, cookies: { '__Host-gr_login': 'other' } });
    assert.equal(res.headers.location, '/admin?error=denied');
  });

  it('redeems a state only once', async () => {
    const auth = await signIn(ctx);
    const replay = await ctx.app.inject({
      url: `/auth/callback?code=a&state=${auth.state}`,
      cookies: { '__Host-gr_login': auth.browser },
    });
    assert.equal(replay.headers.location, '/admin?error=denied');
  });

  it('rejects a valid user who is outside the admin groups', async () => {
    const other = await makeApp({ oidc: { redeem: async () => ({ sub: 'b', username: 'bob', groups: ['players'] }) } });
    const auth = await signIn(other);
    assert.equal(auth.callback.headers.location, '/admin?error=denied');
    assert.equal(auth.cookie, undefined);
    await other.close();
  });

  it('fails closed when no admin group is configured', async () => {
    const other = await makeApp({ adminGroups: [], oidc: { redeem: async () => ({ sub: 'a', username: 'a', groups: [] }) } });
    const auth = await signIn(other);
    assert.equal(auth.cookie, undefined);
    await other.close();
  });

  it('reports a failed code exchange without detail', async () => {
    const other = await makeApp({ oidc: { redeem: async () => { throw new Error('secret detail'); } } });
    const auth = await signIn(other);
    assert.equal(auth.callback.headers.location, '/admin?error=denied');
    await other.close();
  });

  it('rotates the session on a new sign-in', async () => {
    const first = await signIn(ctx);
    const login = await ctx.app.inject({ url: '/auth/login' });
    const state = new URL(login.headers.location).searchParams.get('state');
    const second = await ctx.app.inject({
      url: `/auth/callback?code=a&state=${state}`,
      cookies: { '__Host-gr_login': cookiesOf(login)['__Host-gr_login'].value, '__Host-gr_session': first.cookie },
    });
    assert.notEqual(cookiesOf(second)['__Host-gr_session'].value, first.cookie);
    const old = await ctx.app.inject({ url: '/api/admin/session', cookies: { '__Host-gr_session': first.cookie } });
    assert.equal(old.statusCode, 401);
  });

  it('rate limits sign-in attempts', async () => {
    const other = await makeApp({ rateLimits: { auth: 3 } });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await other.app.inject({ url: '/auth/login' })).statusCode);
    assert.deepEqual(codes, [302, 302, 302, 429, 429]);
    await other.close();
  });
});

describe('admin sessions', () => {
  let ctx;
  beforeEach(async () => { ctx = await makeApp(); });
  afterEach(() => ctx.close());

  const session = (cookie) => ctx.app.inject({ url: '/api/admin/session', cookies: { '__Host-gr_session': cookie } });

  it('refuses requests without a session', async () => {
    assert.equal((await ctx.app.inject({ url: '/api/admin/session' })).statusCode, 401);
    assert.equal((await ctx.app.inject({ method: 'PUT', url: '/api/admin/config', payload: {} })).statusCode, 401);
  });

  it('refuses a forged token', async () => {
    assert.equal((await session('forged-token')).statusCode, 401);
  });

  it('expires when idle', async () => {
    const auth = await signIn(ctx);
    ctx.advance(SESSION_IDLE_MS + 1);
    assert.equal((await session(auth.cookie)).statusCode, 401);
  });

  it('expires at the absolute limit despite activity', async () => {
    const auth = await signIn(ctx);
    let elapsed = 0;
    while (elapsed + SESSION_IDLE_MS / 2 < SESSION_ABSOLUTE_MS) {
      ctx.advance(SESSION_IDLE_MS / 2);
      elapsed += SESSION_IDLE_MS / 2;
      assert.equal((await session(auth.cookie)).statusCode, 200);
    }
    ctx.advance(SESSION_IDLE_MS / 2 + 1);
    assert.equal((await session(auth.cookie)).statusCode, 401);
  });

  it('logout invalidates the session on the server', async () => {
    const auth = await signIn(ctx);
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/logout', payload: {}, ...authed(auth) });
    assert.equal(res.statusCode, 200);
    assert.equal((await session(auth.cookie)).statusCode, 401);
  });

  it('stores only a hash of the session token', async () => {
    const auth = await signIn(ctx);
    assert.equal(ctx.sessions.sessions.has(auth.cookie), false);
    assert.equal(ctx.sessions.sessions.size, 1);
  });
});

describe('CSRF and origin checks', () => {
  let ctx;
  let auth;
  beforeEach(async () => {
    ctx = await makeApp();
    auth = await signIn(ctx);
  });
  afterEach(() => ctx.close());

  const send = (headers) =>
    ctx.app.inject({
      method: 'DELETE',
      url: '/api/admin/sprites/grid/player',
      cookies: { '__Host-gr_session': auth.cookie },
      headers,
    });

  it('accepts the right token and origin', async () => {
    assert.equal((await send({ origin: ORIGIN, 'x-csrf-token': auth.csrf })).statusCode, 200);
  });

  it('rejects a missing token', async () => {
    assert.equal((await send({ origin: ORIGIN })).statusCode, 403);
  });

  it('rejects a wrong token', async () => {
    assert.equal((await send({ origin: ORIGIN, 'x-csrf-token': 'wrong' })).statusCode, 403);
  });

  it('rejects a foreign origin even with the token', async () => {
    assert.equal((await send({ origin: 'https://evil.example', 'x-csrf-token': auth.csrf })).statusCode, 403);
  });

  it('rejects logout without CSRF', async () => {
    const res = await ctx.app.inject({
      method: 'POST', url: '/auth/logout', payload: {},
      cookies: { '__Host-gr_session': auth.cookie }, headers: { origin: ORIGIN },
    });
    assert.equal(res.statusCode, 403);
  });
});

describe('security headers', () => {
  it('are set on public pages', async () => {
    const ctx = await makeApp();
    const res = await ctx.app.inject({ url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-security-policy'], /script-src 'self'/);
    assert.doesNotMatch(res.headers['content-security-policy'], /unsafe/);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['strict-transport-security'], /max-age=/);
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    await ctx.close();
  });

  it('keep private pages out of caches', async () => {
    const ctx = await makeApp();
    const page = await ctx.app.inject({ url: '/admin' });
    assert.equal(page.statusCode, 200);
    assert.equal(page.headers['cache-control'], 'no-store');
    const api = await ctx.app.inject({ url: '/api/admin/session' });
    assert.equal(api.headers['cache-control'], 'no-store');
    await ctx.close();
  });
});
