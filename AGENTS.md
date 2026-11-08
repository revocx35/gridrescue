# AGENTS.md

Notes for AI agents and contributors. Read [ARCHITECTURE.md](ARCHITECTURE.md) for the design and threat model.

## What this is

A public 2D canvas game plus an Authentik-protected admin editor, served by one Node container.
No build step, no bundler, no framework in the browser: `public/` is served as written.

## Layout

```
public/index.html, js/main.js      Game page: applies layout, input, game loop, HUD
public/js/sim.js                   Game rules. No DOM. Runs headless in tests
public/js/render.js                Canvas drawing and the built-in default art
public/js/joystick.js              Pointer Events joystick
public/js/schema.js                Editable config: defaults, limits, validation. Shared by server and admin UI
public/admin.html, js/admin.js     Admin editor
src/server.js                      Entry point: reads the environment
src/app.js                         Fastify routes, security headers, auth checks
src/oidc.js                        OpenID Connect client (authorization code + PKCE)
src/sessions.js                    In-memory sessions and pending logins
src/store.js                       config.json + content-addressed sprites in DATA_DIR
src/png.js                         Strict PNG parser and sanitiser
test/                              node:test suites
scripts/setup.sh                   Creates .env and the self-signed certificate
compose.yaml, Dockerfile           Hardened deployment
```

## Commands

```sh
npm ci                        # install
npm test                      # all tests (91): rules, editor, PNG, auth, real OIDC client against a local issuer
npm start                     # plain HTTP unless TLS_* is set; needs PUBLIC_URL for sign-in
scripts/setup.sh IP:x.x.x.x   # once per checkout
docker compose up -d --build  # deploy
```

## Conventions

- Add an editable field in `public/js/schema.js` only: defaults, limits and validation live there and the admin UI
  builds its forms from those tables. `Store.upgrade` fills new fields in old config files.
- Game rules go in `sim.js`, drawing in `render.js`. `sim.js` must never touch the DOM, `Math.random` directly
  (use `s.rng`) or wall-clock time, so tests stay deterministic.
- User-editable text reaches the page through `textContent` or canvas `fillText` only.
- Dynamic styling goes through `element.style.*` / `style.setProperty`, which CSP allows. Inline `style=` attributes
  and inline scripts are blocked by CSP.
- Keep the UI language in plain words; the visual language is near-black, radial washes, a brand gradient, 14 px
  translucent panels and uppercase micro-labels.
- Sprites only change through `/api/admin/sprites/:role`. `PUT /api/admin/config` rejects a `sprite` key on purpose.

## Never do

- Never commit `.env`, `certs/`, `data/`, or real domains, LAN addresses or client secrets. Docs use placeholders.
- Never loosen the CSP, cookie flags, CSRF or origin checks to make something work.
- Never treat a signed-in user as admin without the `ADMIN_GROUPS` check; empty must keep meaning "nobody".
- Never serve uploaded bytes without `sanitizePng`, or from a path built from anything but a validated hash.
- Never log query strings of `/auth/callback`; the request serializer strips them.
- Never use `client.allowInsecureRequests`, `rejectUnauthorized: false` or similar outside tests.

## Gotchas

- `__Host-` cookies need HTTPS and `Path=/`. Local testing has to use HTTPS or `localhost`.
- The session cookie is `SameSite=Lax`, not Strict: the browser arrives at `/admin` through a redirect chain that
  began at the identity provider, and Strict would drop it. CSRF tokens protect state changes.
- Sessions are in memory, so a restart signs admins out. Game config is unaffected.
- `TRUST_PROXY` must list the reverse proxy, otherwise every player shares one rate-limit bucket.
- `@fastify/static`'s `setHeaders` receives a Fastify reply, not a raw response.
- `node --test test/` tries to run the directory as a module. Use the glob in `npm test`.
- The container has a read-only root; anything written must go to `/data` or `/tmp`.
- The sprite file input has no `accept` filter on purpose: phones would open the photo picker instead of their file
  browser, and some Android file providers report no MIME type. The server's `sanitizePng` decides what is a PNG.
- nginx cannot verify IP SANs, so a proxy pinning the upstream certificate must use `proxy_ssl_name localhost`.
- `@fastify/rate-limit` counts `/auth/*` separately. Scripted sign-in tests hit the limit quickly.
