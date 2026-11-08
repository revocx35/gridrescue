// Container health probe. Over TLS it verifies the server against the pinned certificate.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const port = Number(process.env.PORT ?? 8443);
const certFile = process.env.TLS_CERT_FILE;
const secure = certFile && fs.existsSync(certFile);
const request = (secure ? https : http).get(
  { host: 'localhost', port, path: '/healthz', timeout: 4000, ...(secure ? { ca: fs.readFileSync(certFile) } : {}) },
  (res) => process.exit(res.statusCode === 200 ? 0 : 1),
);
request.on('error', () => process.exit(1));
request.on('timeout', () => process.exit(1));
