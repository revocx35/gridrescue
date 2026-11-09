import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createApp } from '../src/app.js';
import { Leaderboard, RunTokens } from '../src/leaderboard.js';
import { Sessions } from '../src/sessions.js';
import { Store } from '../src/store.js';

export const ORIGIN = 'https://game.example.test';

export function chunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(typed.length + 8);
  out.writeUInt32BE(data.length, 0);
  typed.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(typed), typed.length + 4);
  return out;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Builds a real RGBA PNG. `extra` chunks go between IHDR and IDAT. */
export function makePng(width = 2, height = 2, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height, 0x7f);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function fakeOidc(overrides = {}) {
  return {
    authorizationUrl: async ({ state }) => `https://idp.example.test/authorize?state=${state}`,
    redeem: async () => ({ sub: 'u1', username: 'alice', groups: ['editors'] }),
    ...overrides,
  };
}

export async function makeApp(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridrescue-'));
  const store = new Store(dir, { error() {} });
  let clock = 1_000_000;
  const sessions = new Sessions(() => clock);
  const leaderboard = new Leaderboard(dir, { error() {} }, () => clock);
  const runs = new RunTokens(() => clock);
  const app = await createApp({
    store,
    leaderboard,
    runs,
    sessions,
    oidc: fakeOidc(options.oidc),
    adminGroups: options.adminGroups ?? ['editors'],
    publicUrl: ORIGIN,
    logger: false,
    rateLimits: { auth: 10_000, write: 10_000, run: 10_000, score: 10_000, ...options.rateLimits },
  });
  await app.ready();
  return {
    app,
    store,
    leaderboard,
    runs,
    sessions,
    dir,
    advance: (ms) => { clock += ms; },
    close: async () => {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function cookiesOf(response) {
  return Object.fromEntries(response.cookies.map((c) => [c.name, c]));
}

/** Runs the sign-in redirect dance and returns the session cookie plus the CSRF token. */
export async function signIn(ctx) {
  const login = await ctx.app.inject({ url: '/auth/login' });
  const state = new URL(login.headers.location).searchParams.get('state');
  const browser = cookiesOf(login)['__Host-gr_login'].value;
  const callback = await ctx.app.inject({
    url: `/auth/callback?code=abc&state=${state}`,
    cookies: { '__Host-gr_login': browser },
  });
  const cookie = cookiesOf(callback)['__Host-gr_session']?.value;
  let csrf = null;
  if (cookie) {
    const session = await ctx.app.inject({ url: '/api/admin/session', cookies: { '__Host-gr_session': cookie } });
    csrf = session.json().csrf;
  }
  return { cookie, csrf, callback, state, browser };
}

export function authed(auth, extra = {}) {
  return {
    cookies: { '__Host-gr_session': auth.cookie },
    ...extra,
    headers: { origin: ORIGIN, 'x-csrf-token': auth.csrf, ...extra.headers },
  };
}
