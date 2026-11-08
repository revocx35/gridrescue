// Exercises the real openid-client code path against a small local issuer.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import * as client from 'openid-client';
import * as jose from 'jose';
import { createOidc } from '../src/oidc.js';

const CLIENT_ID = 'game';
const CLIENT_SECRET = 'test-client-secret';
const REDIRECT = 'https://game.example.test/auth/callback';

let server;
let issuer;
let keys;
const behaviour = {};
const codes = new Map();

function clientIsValid(header, form) {
  if (form.get('client_secret')) return form.get('client_id') === CLIENT_ID && form.get('client_secret') === CLIENT_SECRET;
  const [user, pass] = Buffer.from((header ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
  return decodeURIComponent(user) === CLIENT_ID && decodeURIComponent(pass) === CLIENT_SECRET;
}

before(async () => {
  keys = await jose.generateKeyPair('RS256');
  const jwk = { ...(await jose.exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const json = (body, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/userinfo') return json({ sub: 'user-1', groups: ['from-userinfo'] });
    if (url.pathname === '/token') {
      let raw = '';
      for await (const part of req) raw += part;
      const form = new URLSearchParams(raw);
      if (!clientIsValid(req.headers.authorization, form)) return json({ error: 'invalid_client' }, 401);
      const grant = codes.get(form.get('code'));
      if (!grant) return json({ error: 'invalid_grant' }, 400);
      const challenge = crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== grant.challenge) return json({ error: 'invalid_grant' }, 400);
      const claims = { sub: 'user-1', preferred_username: 'alice', nonce: behaviour.nonce ?? grant.nonce };
      if (!behaviour.omitGroups) claims.groups = ['editors'];
      const idToken = await new jose.SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(behaviour.issuer ?? issuer)
        .setAudience(behaviour.audience ?? CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
      return json({ access_token: 'at', token_type: 'Bearer', id_token: idToken, expires_in: 300 });
    }
    return json({}, 404);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function oidcClient(secret = CLIENT_SECRET) {
  return createOidc({
    issuer, clientId: CLIENT_ID, clientSecret: secret, redirectUri: REDIRECT,
    execute: [client.allowInsecureRequests], // only because this test issuer is local HTTP
  });
}

async function login(oidc, { tamperState = false } = {}) {
  const state = 'state-value';
  const nonce = 'nonce-value';
  const codeVerifier = client.randomPKCECodeVerifier();
  const url = new URL(await oidc.authorizationUrl({ state, nonce, codeVerifier }));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  const code = crypto.randomUUID();
  codes.set(code, { challenge: url.searchParams.get('code_challenge'), nonce });
  return oidc.redeem({
    callbackUrl: `${REDIRECT}?code=${code}&state=${tamperState ? 'other' : state}`,
    state, nonce, codeVerifier,
  });
}

describe('OIDC exchange', () => {
  it('returns verified identity and groups', async () => {
    Object.keys(behaviour).forEach((k) => delete behaviour[k]);
    assert.deepEqual(await login(oidcClient()), { sub: 'user-1', username: 'alice', groups: ['editors'] });
  });

  it('falls back to userinfo when the ID token has no groups', async () => {
    Object.assign(behaviour, { omitGroups: true });
    const identity = await login(oidcClient());
    delete behaviour.omitGroups;
    assert.deepEqual(identity.groups, ['from-userinfo']);
  });

  it('rejects a mismatched state', async () => {
    await assert.rejects(login(oidcClient(), { tamperState: true }));
  });

  it('rejects a wrong nonce', async () => {
    behaviour.nonce = 'replayed';
    await assert.rejects(login(oidcClient()));
    delete behaviour.nonce;
  });

  it('rejects a token for another audience', async () => {
    behaviour.audience = 'someone-else';
    await assert.rejects(login(oidcClient()));
    delete behaviour.audience;
  });

  it('rejects a token from another issuer', async () => {
    behaviour.issuer = 'https://evil.example';
    await assert.rejects(login(oidcClient()));
    delete behaviour.issuer;
  });

  it('rejects a wrong client secret', async () => {
    await assert.rejects(login(oidcClient('wrong')));
  });
});
