# Architecture

## Components

```
Browser ──HTTPS──▶ Reverse proxy ──HTTPS (pinned, self-signed)──▶ Node container ──▶ /data volume
   │                                                                   │
   └──────── sign-in redirect ───▶ Authentik ◀── code exchange (TLS) ──┘
```

**Game client** (`public/js/main.js`, `sim.js`, `render.js`, `joystick.js`). Fetches `/api/config` and runs entirely in
the browser. There is no server-side game state and no multiplayer.

**Simulation** (`sim.js`). Fixed 60 Hz steps over plain objects. It emits an event queue (`kill`, `hint`, `bossDead`,
...) that the page turns into effects and messages. Being DOM-free lets tests play whole games headlessly.

**Server** (`src/`). Fastify serves static files, the public config, sprites and the admin API.

**Store** (`store.js`). `config.json` written atomically, with sprites at `sprites/<sha256>.png`. Unreferenced sprites
are deleted on every commit. A monotonically increasing `revision` gives optimistic locking between admin tabs.

## Game rules

- The world is unbounded: positions are plain numbers and the floor is computed from the camera. Floor variation comes
  from hashing cell coordinates.
- The config holds several maps (`config.maps.<id>`: `name`, `characters`). `site` and `gameplay` are shared. The player
  picks a map on the start or end screen; sprites load per map on first use.
- The forest map (`scenery.js`) builds obstacles per 480 px chunk from a per-run seed: slow noise decides forest or open
  ground, jittered cells place trees, and each chunk rolls for wrecked tanks. Chunks are pure functions of the seed, so the
  cache can be dropped at any time and nothing is stored. Trees and tanks are circles to collision. Actors slide around
  them and big actors count as slim so they fit between trees. Bullets stop on them; enemy 5's ball does not. The start and
  the boss arena are kept clear.
- The hostage is placed at a random angle, 85 to 115% of `hostageDistance` from the start.
- Enemies appear just outside the view at intervals that shorten over time. Enemy 1 is a weighted rarity
  (`enemy1Chance`) with more health and damage. Enemy 5 is rarer still (`enemy5Chance`) and cannot appear in the first 40
  seconds. It walks like a melee enemy and every `fireInterval` seconds locks a line for half a second, then throws a ball
  whose texture, size, speed and damage come from that map's `ball` role. Enemies far behind the player despawn, which is what makes running
  away work.
- Every regular kill lights a wedge `hintSpread` degrees wide. Its centre is offset randomly by up to 40% of the
  width, so the true direction is always inside it, but never reliably in the middle.
- The companion spawns at `companionKills` kills or within `companionDistance` of the hostage, whichever is first, so
  it always arrives before the player does. When downed it returns after 9 seconds.
- Each enemy role has an `attackType`. Melee hits on contact. Sniper stops at long range, shows an aim line, locks its
  direction and fires one fast bullet. Pump closes in and fires a five-pellet spread. Ranged enemies only fire from inside
  the player's view and do no contact damage.
- The boss's attack type replaces its primary attack: pump is the fan plus the ring, sniper is single fast bullets, and
  melee fires nothing but charges more often. All three keep the charge.
- Destroyed regular enemies drop XP orbs (`xp` per role). Orbs drift to a nearby player and vanish if left far behind. At
  `xpToUpgrade` the state becomes `levelup`, which `step` ignores, so the world is truly frozen until `applyUpgrade`. XP
  over the threshold carries over and can open the menu again at once.
- Upgrades belong to the run (`s.gun`, `s.companions`, `player.maxHp`) and never change the admin's config: pump gun, a
  percentage more of base damage (additive), more health, one more companion (at most six), and bullets piercing one more enemy. Companions keep their own
  plain gun.
- The boss sleeps until the player enters the arena or shoots it, cannot leave the arena, and heals if the player
  runs far enough to make it go home. Under half health its attacks speed up.
- The game is won only by touching the hostage after the boss is dead, and lost at zero player health.

## Leaderboard

The server records when each run starts (`POST /api/runs`, a one-time token stored only as a hash, in memory, 3 hour
life). After a win the browser posts the token, a name, the time and the kills. Only wins can be posted. The map comes from
the token. Each map keeps its top 50 by shortest time and top 50 by most kills in `leaderboard.json`; the public view shows
ten of each. A restart loses open run tokens, so a run in progress at that moment cannot be saved.

## Page layout

`data-layout` on `<body>` is `mobile` for coarse pointers or narrow windows. Admin-chosen section order is applied
with CSS `order`. Desktop shows title and game; mobile adds the panel with the move and aim sticks. A phone in landscape puts one stick on
each side of the game because there is not enough height to stack them.

## Admin data flow

1. `/auth/login` creates `state`, `nonce`, a PKCE verifier and a browser-binding cookie, then redirects to the issuer.
2. `/auth/callback` redeems `state` once, compares the binding cookie, and lets `openid-client` verify the code
   exchange, issuer, audience, signature and nonce.
3. The `groups` claim must intersect `ADMIN_GROUPS`. A new session token is issued and any earlier one destroyed.
4. Writes require the session cookie, the session's CSRF token in `x-csrf-token`, and an exact `Origin` match.

## Key decisions

- **No forward auth at the proxy.** The game must stay public, so only `/admin` flows authenticate, inside the app.
- **Sessions in memory.** One instance, a handful of admins; a restart costing a re-login is cheaper than a session store.
- **JSON file, not a database.** One small document, written rarely, by one process.
- **Raw PNG `PUT`, no multipart.** Smaller attack surface and one fewer dependency.
- **Any image format, converted in the browser.** The admin's browser decodes JPG, WebP, GIF, SVG and so on, draws it to a
  canvas and uploads a PNG of at most 1024 px. Native image decoders are a classic attack surface, so the server never
  runs one; it only parses and rebuilds PNG. An animated image keeps its first frame.
- **Content-addressed sprites** can be cached forever, and two roles may share one file.
- **Auto-fire with optional aiming.** Holding the aim stick, or the left mouse button on desktop, fires that way; letting
  go returns to auto-aim, so the game stays playable with one thumb or the keyboard alone.
- **Shared `schema.js`** so server validation and admin form limits cannot drift apart.

## Platform constraints

- Runs as uid 1000 with a read-only root, no capabilities, `no-new-privileges`, memory and PID limits.
- Needs Node 22.2 or newer for `zlib.crc32`.
- Inside an LXC, Docker needs the `nesting` and `keyctl` features.

## Threat model

| Threat | Defence |
|---|---|
| Stolen or forged admin session | 256-bit random token, only its SHA-256 stored; `__Host-`, `Secure`, `HttpOnly`; 30 min idle and 8 h absolute limits; rotated at sign-in; logout deletes it server-side |
| Password guessing, 2FA | Delegated to Authentik; the app never sees a password. `/auth/*` is rate limited per IP |
| Login CSRF, code injection | One-time `state` bound to a browser cookie, PKCE, nonce; redirect URI comes from `PUBLIC_URL`, never the `Host` header |
| Signed-in non-admin | `groups` must match `ADMIN_GROUPS`; an empty list means no admins |
| Cross-site writes | CSRF token (constant-time compare) plus exact `Origin` check |
| Forged leaderboard scores | Partly mitigated. The rules run in the browser, so a determined cheat can post a believable score. One-time run tokens, a minimum possible time, a maximum possible kill count, a check against real elapsed time and rate limits stop casual forgery; admins delete the rest |
| Leaderboard spam and storage growth | Per-address rate limits, 1 KB request bodies, a cap on open run tokens and a fixed number of stored entries |
| Abusive or disguised public names | 20 characters, control, zero-width and direction-override characters rejected, plain text only; admins can delete entries |
| XSS through names or text | `textContent` and canvas only; strict CSP with no inline script or style; input limits reject control characters |
| Malicious uploads | Admin-only, 2 MB cap, PNG parsed chunk by chunk with CRC checks, dimension limit, bounded inflate against bombs, rebuilt from a chunk allowlist so metadata and trailing payloads are dropped; stored by hash; served as `image/png` with `nosniff` and a sandbox CSP |
| Path traversal | Sprite paths come only from a validated SHA-256 name |
| Abuse and resource exhaustion | Per-IP rate limits, 64 KB JSON limit, capped sessions, pending logins and connections, request timeouts |
| Information leaks | Generic error bodies and sign-in messages; cookies, tokens and callback query strings are excluded from logs; `no-store` on private responses |
| Network interception | TLS on every hop; the proxy pins the container's certificate; the OIDC client verifies certificates; HSTS |
| Container escape, tampering | Non-root, read-only root, `cap_drop: ALL`, `no-new-privileges` |

Not covered: cheating. The game runs in the player's browser and has no scores or server-side state to protect.
Sign-out ends the session here but leaves the Authentik session alive, so that other applications stay signed in.
