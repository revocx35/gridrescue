// Process entry point: reads the environment and starts the HTTP(S) listener.
import fs from 'node:fs';
import { createApp } from './app.js';
import { createOidc } from './oidc.js';
import { Sessions } from './sessions.js';
import { Store } from './store.js';

const env = process.env;
const list = (value) => (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

const port = Number(env.PORT ?? 8443);
const publicUrl = env.PUBLIC_URL ?? `https://localhost:${port}`;
const origin = new URL(publicUrl).origin;
const adminGroups = list(env.ADMIN_GROUPS);

let oidc = null;
if (env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && adminGroups.length) {
  oidc = createOidc({
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: `${origin}/auth/callback`,
  });
}

const https =
  env.TLS_CERT_FILE && env.TLS_KEY_FILE && fs.existsSync(env.TLS_CERT_FILE) && fs.existsSync(env.TLS_KEY_FILE)
    ? { cert: fs.readFileSync(env.TLS_CERT_FILE), key: fs.readFileSync(env.TLS_KEY_FILE) }
    : null;

const trustProxy = list(env.TRUST_PROXY);

const store = new Store(env.DATA_DIR ?? './data');
const app = await createApp({
  store,
  sessions: new Sessions(),
  oidc,
  adminGroups,
  publicUrl,
  https,
  trustProxy: trustProxy.length ? trustProxy : false,
});

if (!oidc) app.log.warn('OIDC_* or ADMIN_GROUPS not set: the admin area is disabled');
if (!https) app.log.warn('TLS_CERT_FILE/TLS_KEY_FILE not found: serving plain HTTP, for local development only');

await app.listen({ host: '0.0.0.0', port });
app.server.maxConnections = 2048;

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => app.close().finally(() => process.exit(0)));
}
