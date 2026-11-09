// Process entry point: reads the environment and starts the HTTP(S) listener.
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { Leaderboard, RunTokens } from './leaderboard.js';
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

const dataDir = env.DATA_DIR ?? './data';
const store = new Store(dataDir);
const runs = new RunTokens();
const openRunsFile = path.join(dataDir, 'open-runs.json');
runs.load(openRunsFile);
const app = await createApp({
  store,
  leaderboard: new Leaderboard(dataDir),
  runs,
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
  process.once(signal, () => {
    // Before closing, which can outlast the container's stop timeout while connections drain.
    try {
      runs.save(openRunsFile);
    } catch (err) {
      app.log.error({ err: err.message }, 'could not save open runs');
    }
    app.close().finally(() => process.exit(0));
  });
}
