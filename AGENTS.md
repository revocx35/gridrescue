# AGENTS.md

Notes for AI agents and contributors. Read [ARCHITECTURE.md](ARCHITECTURE.md) for the design and threat model.

## What this is

A public 2D canvas game plus an Authentik-protected admin editor, served by one Node container.
No build step, no bundler, no framework in the browser: `public/` is served as written.

## Layout

```
public/index.html, js/main.js      Game page: applies layout, input, game loop, HUD
public/js/sim.js                   Game rules. No DOM. Runs headless in tests
public/js/scenery.js               Map obstacles (forest trees and tanks, wasteland buses, signs and hills): seeded chunks, collision, lookup. No DOM
public/js/sound.js                 Plays uploaded sounds through Web Audio; loops idle sounds and the boss theme
public/js/audio-convert.js         Prepares a sound for upload: keeps MP3, converts anything else to WAV in the browser
public/js/render.js                Canvas drawing and the built-in default art for each map
public/js/leaderboard.js           Leaderboard API calls and tables, used by the game and the admin tab
public/js/joystick.js              Pointer Events joystick (one instance each for moving and aiming)
public/js/schema.js                Editable config: defaults, limits, validation. Shared by server and admin UI
public/admin.html, js/admin.js     Admin editor
public/js/image-convert.js         Converts any browser-readable image to a size-limited PNG before upload
src/server.js                      Entry point: reads the environment
src/app.js                         Fastify routes, security headers, auth checks
src/oidc.js                        OpenID Connect client (authorization code + PKCE)
src/sessions.js                    In-memory sessions and pending logins
src/store.js                       config.json + content-addressed sprites in DATA_DIR
src/leaderboard.js                 leaderboard.json storage and one-time run tokens
src/png.js                         Strict PNG parser and sanitiser
src/audio.js                       Strict WAV and MP3 parser that rebuilds each file from its audio data alone
test/                              node:test suites
scripts/setup.sh                   Creates .env and the self-signed certificate
compose.yaml, Dockerfile           Hardened deployment
```

## Commands

```sh
npm ci                        # install
npm test                      # all tests (367): rules, modes, editor, PNG, audio, auth, real OIDC client against a local issuer
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
- Upgrades live in the run state, never in `s.cfg`. Tests and live code both read base stats from `s.cfg` at fire time.
- Only `Game.onKey`'s level-up branch may handle keys during the menu: Enter must never reach the restart path.
- A game runs on `mapConfig(config, mapId)`: shared `site` and `gameplay` plus one map's `characters`. Never read
  `config.characters`; it no longer exists at the top level.
- `ball` is a role with a texture and stats but no name. Use `NAMED_ROLES` wherever a name is shown or validated.
- Obstacle positions come only from `scenery.js`, so rules and drawing cannot disagree. Keep whole obstacles inside their
  chunk: the lookups depend on it.
- Sprites only change through `/api/admin/sprites/:map/:role` and sounds through `/api/admin/sounds/:map/:role/:slot`.
  `PUT /api/admin/config` rejects `sprite` and `sounds` keys on purpose.
- Pacing lives per map in `maps.<id>.spawns` (`SPAWN_FIELDS`: interval and cap), which `mapConfig` merges into `gameplay`. How likely each character is lives on the character as
  `spawnChance` (Rocketeer: chance a map area has a bus). `Store.upgrade` moves both older forms (shared `gameplay`, then per-map chances) and strips the old keys, so never
  add them back. Regular enemies are picked in proportion to their chances, so these need not add up to 1; the Su-34 and Endless boss are separate rolls first.
- Use `mapRoles(mapId)`, not `ROLES`, when walking one map's characters: `rocketeer` and `rocket` exist on the wasteland only.
- A sound slot is declared in `SOUND_SLOTS` only. There are no built-in sounds and there must never be: an empty slot is silent.
- Rules emit `shot` and `kamikaze` events with a `role`. Audio lives in `sound.js` and reacts to those; `sim.js` knows nothing about sound.

## Never do

- Never take a score's map from the request, or accept one without `runs.take`: the map and limits belong to the run token.
- Never show a leaderboard name except through `textContent`. Anyone can submit one.
- Never commit `.env`, `certs/`, `data/`, or real domains, LAN addresses or client secrets. Docs use placeholders.
- Never loosen the CSP, cookie flags, CSRF or origin checks to make something work.
- Never treat a signed-in user as admin without the `ADMIN_GROUPS` check; empty must keep meaning "nobody".
- Never serve uploaded bytes without `sanitizePng`, or from a path built from anything but a validated hash.
- Never log query strings of `/auth/callback`; the request serializer strips them.
- Never serve uploaded audio without `sanitizeAudio`, or decode audio on the server. Conversion happens in the admin's browser.
- Never add an inline or `media-src` CSP exception for sounds: playback uses `fetch` and Web Audio on purpose.
- Never put a `mode` on a score request: like the map, it belongs to the run token.
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
  browser, and some Android file providers report no MIME type. Whether a file is an image is decided by trying to
  decode it in the browser (`image-convert.js`).
- Sprites and sounds can also be dropped on their card or row (`acceptDrops` in `admin.js`). Drops call the same upload functions as the buttons, so there is
  no second path to secure. Phones have no file drag, so the buttons must stay.
- Any image format is converted to PNG in the admin's browser, so formats depend on that browser (HEIC opens in Safari,
  usually not in Chrome). Do not add server-side image decoders for this: the server accepting only sanitised PNG is a
  security property.
- Flat configs from before maps become the first map in `Store.upgrade`. The 10/40 XP swap runs only on that flat form, so an
  admin who later picks those values keeps them.
- `upgradeDamage` and `upgradeFireRate` are percentages of the base value and stack additively (`s.gun.*Percent`).
- `scoreLimits` in `sim.js` must stay true of real play. If spawn pacing, hostage distance, movement or bus density changes, update it and
  keep the "score limits" test passing, or real wins get rejected.
- The page sets `user-select: none`, and global key handlers treat WASD as movement. Any new text input needs
  `user-select: text`, a 16 px font for iOS, and the `closest('input')` guard in `Keyboard`.
- To find out why a score was refused, look for `score rejected` in the container log; `problem` gives the reason.
- "Restore defaults" does not touch the leaderboard; only its own admin tab does.
- Enemy stats are per actor now (`e.size`, `e.damage`, `e.xp`), set at spawn from the current level. Draw and hit-test those,
  not `characters[kind]`. Tests that build enemies by hand must set them. Speed and size never scale.
- The `enabled` switch exists only on roles listed with it in `ROLE_FIELDS`. A map must keep a regular enemy on, because direction
  hints come from kills. With the boss off, `s.boss.alive` is false from the start and spawning keeps going.
- Jet and missile images are drawn rotated to their heading, so uploads must face right. Missiles are in `s.missiles`, not
  `s.enemies`, and only `destroyMissileAt` removes one early: bullets and auto-aim ignore them, and it is not a kill.
- Rockets (`kind: 'rocket'`) share `s.missiles` with Kh-29s but are the opposite to deal with: bullets and auto-aim hit them, and clicks still work.
  Only rockets are shot down; a Kh-29 still needs `destroyMissileAt`. The Su-34 can also appear on the wasteland.
- Buses and signs stop actors but not shots; hills stop both (`chunk.circles` versus `chunk.cover`). The Rocketeer on a bus roof has to stay reachable, so keep the two lists apart.
- A sign's solid width is fixed in `scenery.js` while its text is admin-written, so the board is a fixed width and long words shrink to fit (`#drawSign`). Do not size the board from its text.
- Hills stay within `HILL_MARGIN` of their chunk's edge so that neighbouring hills always leave a gap wide enough to walk through. Raising the lobe count or radius needs `HILL_REACH` and the margin raised with it.
- `s.crewedBuses` is the only record of which buses are manned. Despawning a Rocketeer by distance removes its entry, so it comes back; killing one leaves the entry, so it does not.
- In Endless `s.hostage` is null and `s.boss.alive` is false, so check `s.hostage` before using it. The rare Endless boss is an ordinary `s.enemies` entry with `kind: 'boss'`, so compare with `e === s.boss`, never `e.kind`, to mean the guardian.
- Kamikaze is not a kill: no XP and no `kills` increment unless a shot gets it first. It is not offered for the boss (`notFor` in `CHARACTER_FIELDS`).
- Playwright's `wait_for_function` is blocked by the CSP (no `unsafe-eval`). Use selector waits in browser tests.
- Enemy 5 cannot spawn in the first 40 seconds of a run (`ENEMY5_EARLIEST`). Spawn tests must set `s.time`.
- Removing or renaming a config option needs a mapping in `Store.upgrade`. A stored value that no longer validates makes
  the whole file count as corrupt, so it gets moved aside and the game falls back to defaults.
- nginx cannot verify IP SANs, so a proxy pinning the upstream certificate must use `proxy_ssl_name localhost`.
- `@fastify/rate-limit` counts `/auth/*` separately. Scripted sign-in tests hit the limit quickly.
