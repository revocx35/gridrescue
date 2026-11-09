// HTTP application. Everything environment-specific is injected, so tests can drive it directly.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import * as oidcClient from 'openid-client';
import { MAPS, ROLES, cleanScoreName, mapConfig, validateConfig } from '../public/js/schema.js';
import { scoreLimits } from '../public/js/sim.js';
import { InvalidPng, MAX_SPRITE_BYTES, sanitizePng } from './png.js';
import { PENDING_LOGIN_MS, SESSION_ABSOLUTE_MS, randomToken, safeEqual } from './sessions.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SESSION_COOKIE = '__Host-gr_session';
const LOGIN_COOKIE = '__Host-gr_login';
const JSON_LIMIT = 64 * 1024;
const SCORE_BODY_LIMIT = 1024;

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const cookieOptions = { path: '/', secure: true, httpOnly: true, sameSite: 'lax' };

/**
 * options: { store, leaderboard, runs, sessions, oidc, adminGroups: string[], publicUrl, trustProxy, https, logger, rateLimits }
 * `oidc` may be null, in which case the admin area reports that sign-in is unavailable.
 */
export async function createApp(options) {
  const { store, leaderboard, runs, sessions, oidc, adminGroups, publicUrl } = options;
  const origin = new URL(publicUrl).origin;
  const limits = { auth: 20, write: 120, run: 60, score: 12, ...options.rateLimits };

  const app = Fastify({
    https: options.https ?? null,
    trustProxy: options.trustProxy ?? false,
    bodyLimit: JSON_LIMIT,
    requestTimeout: 30_000,
    connectionTimeout: 60_000,
    logger: options.logger ?? {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
      serializers: {
        // Query strings are dropped: the OIDC callback carries a code and state there.
        req: (req) => ({ method: req.method, url: req.url.split('?')[0], ip: req.ip }),
      },
    },
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 900, timeWindow: '1 minute' });

  app.addHook('onSend', async (request, reply) => {
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', CSP);
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (origin.startsWith('https:')) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    reply.removeHeader('X-Powered-By');
  });

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) request.log.error(err);
    const codes = { 400: 'bad_request', 413: 'too_large', 415: 'unsupported_type', 429: 'rate_limited' };
    reply.code(status).send({ error: codes[status] ?? 'server_error' });
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: 'not_found' }));

  app.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: MAX_SPRITE_BYTES }, (req, body, done) => {
    done(null, body);
  });

  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    index: ['index.html'],
    cacheControl: false,
    setHeaders: (reply, file) => reply.header('Cache-Control', file.endsWith('admin.html') ? 'no-store' : 'no-cache'),
  });

  // ---- public ----

  app.get('/healthz', { config: { rateLimit: false }, logLevel: 'warn' }, async () => ({ ok: true }));

  app.get('/api/config', async (request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return store.publicConfig();
  });

  app.get('/sprites/:file', async (request, reply) => {
    const match = /^([0-9a-f]{64})\.png$/.exec(request.params.file);
    const png = match && store.readSprite(match[1]);
    if (!png) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .type('image/png')
      .send(png);
  });

  // ---- leaderboard ----

  const isObject = (value) => typeof value === 'object' && value !== null;
  const publicWrite = (max) => ({ bodyLimit: SCORE_BODY_LIMIT, config: { rateLimit: { max, timeWindow: '1 minute' } } });

  app.get('/api/leaderboard', async (request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return leaderboard.view();
  });

  app.post('/api/runs', publicWrite(limits.run), async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const map = isObject(request.body) ? request.body.map : null;
    if (!MAPS.includes(map)) return reply.code(400).send({ error: 'bad_request' });
    return { token: runs.issue(map, scoreLimits(mapConfig(store.snapshot().config, map))) };
  });

  app.post('/api/leaderboard', publicWrite(limits.score), async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!isObject(request.body)) return reply.code(400).send({ error: 'bad_request' });
    const { token, time, kills, won } = request.body;
    // Checked first, and without spending the token, so a player can fix a rejected name.
    const name = cleanScoreName(request.body.name);
    if (!name) return reply.code(422).send({ error: 'invalid_name' });
    const run = runs.take(token);
    if (!run || !runs.isPlausible(run, { time, kills, won })) return reply.code(403).send({ error: 'invalid_run' });
    return leaderboard.add(run.map, { name, time: Math.round(time * 100) / 100, kills, won });
  });

  app.get('/admin', async (request, reply) => reply.sendFile('admin.html'));

  // ---- sign-in ----

  const authLimit = { rateLimit: { max: limits.auth, timeWindow: '1 minute' } };
  const noStore = (reply) => reply.header('Cache-Control', 'no-store');
  const redirectUri = `${origin}/auth/callback`;

  app.get('/auth/login', { config: authLimit }, async (request, reply) => {
    noStore(reply);
    if (!oidc) return reply.redirect('/admin?error=unavailable');
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = oidcClient.randomPKCECodeVerifier();
    const browser = randomToken();
    let url;
    try {
      url = await oidc.authorizationUrl({ state, nonce, codeVerifier });
    } catch (err) {
      request.log.error({ err: err.message }, 'identity provider unavailable');
      return reply.redirect('/admin?error=unavailable');
    }
    sessions.addPending(state, { nonce, codeVerifier, browser });
    reply.setCookie(LOGIN_COOKIE, browser, { ...cookieOptions, maxAge: PENDING_LOGIN_MS / 1000 });
    return reply.redirect(url);
  });

  app.get('/auth/callback', { config: authLimit }, async (request, reply) => {
    noStore(reply);
    reply.clearCookie(LOGIN_COOKIE, cookieOptions);
    const denied = () => reply.redirect('/admin?error=denied');
    const pending = oidc ? sessions.takePending(request.query.state) : null;
    if (!pending || !safeEqual(pending.browser, request.cookies[LOGIN_COOKIE])) return denied();

    let identity;
    try {
      identity = await oidc.redeem({
        callbackUrl: `${origin}${request.raw.url}`,
        state: request.query.state,
        nonce: pending.nonce,
        codeVerifier: pending.codeVerifier,
      });
    } catch (err) {
      request.log.warn({ err: err.message }, 'sign-in rejected');
      return denied();
    }
    // Fail closed: no configured admin group means nobody is an admin.
    if (!identity.groups.some((group) => adminGroups.includes(group))) {
      request.log.warn({ user: identity.username }, 'sign-in without an admin group');
      return denied();
    }

    sessions.destroy(request.cookies[SESSION_COOKIE]); // rotation: a pre-login session never survives
    const token = sessions.create({ sub: identity.sub, username: identity.username });
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_ABSOLUTE_MS / 1000 });
    return reply.redirect('/admin');
  });

  // ---- admin API ----

  async function requireAdmin(request, reply) {
    noStore(reply);
    const session = sessions.get(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    if (request.method !== 'GET') {
      const sameOrigin = request.headers.origin === origin;
      if (!sameOrigin || !safeEqual(request.headers['x-csrf-token'], session.csrf)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
    }
    request.session = session;
  }

  const writeRoute = (extra = {}) => ({
    preHandler: requireAdmin,
    config: { rateLimit: { max: limits.write, timeWindow: '1 minute' } },
    ...extra,
  });

  const adminState = (session) => ({
    user: session.user.username,
    csrf: session.csrf,
    ...store.snapshot(),
  });

  app.get('/api/admin/session', { preHandler: requireAdmin }, async (request) => adminState(request.session));

  app.post('/auth/logout', writeRoute(), async (request, reply) => {
    sessions.destroy(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });

  app.put('/api/admin/config', writeRoute(), async (request, reply) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null || !Number.isInteger(body.revision)) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    if (body.revision !== store.revision) return reply.code(409).send({ error: 'stale_revision' });
    const result = validateConfig(body.config);
    if (!result.ok) return reply.code(422).send({ error: 'invalid_config', details: result.errors });
    store.replace(result.value);
    return adminState(request.session);
  });

  app.post('/api/admin/config/reset', writeRoute(), async (request) => {
    store.reset();
    return adminState(request.session);
  });

  /** True when the URL names a real map and role; otherwise answers 404. */
  const knownSlot = ({ params }, reply) => {
    if (MAPS.includes(params.map) && ROLES.includes(params.role)) return true;
    reply.code(404).send({ error: 'not_found' });
    return false;
  };

  app.put('/api/admin/sprites/:map/:role', writeRoute({ bodyLimit: MAX_SPRITE_BYTES }), async (request, reply) => {
    if (!knownSlot(request, reply)) return reply;
    if (request.headers['content-type'] !== 'image/png') {
      return reply.code(415).send({ error: 'unsupported_type' });
    }
    let png;
    try {
      png = sanitizePng(request.body);
    } catch (err) {
      if (!(err instanceof InvalidPng)) throw err;
      return reply.code(422).send({ error: 'invalid_png' });
    }
    store.setSprite(request.params.map, request.params.role, png);
    return adminState(request.session);
  });

  app.delete('/api/admin/sprites/:map/:role', writeRoute(), async (request, reply) => {
    if (!knownSlot(request, reply)) return reply;
    store.clearSprite(request.params.map, request.params.role);
    return adminState(request.session);
  });

  app.get('/api/admin/leaderboard', { preHandler: requireAdmin }, async () => leaderboard.all());

  app.delete('/api/admin/leaderboard/:map/:id', writeRoute(), async (request, reply) => {
    const { map, id } = request.params;
    if (!MAPS.includes(map) || !leaderboard.remove(map, id)) return reply.code(404).send({ error: 'not_found' });
    return leaderboard.all();
  });

  app.delete('/api/admin/leaderboard/:map', writeRoute(), async (request, reply) => {
    if (!MAPS.includes(request.params.map)) return reply.code(404).send({ error: 'not_found' });
    leaderboard.clear(request.params.map);
    return leaderboard.all();
  });

  return app;
}
