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
  picks a map and mode on the start or end screen, and the browser remembers both across reloads; sprites load per map on first use.
- The wasteland (`scenery.js`) has the same chunk system with its own contents: brown trees at the forest's density (the same planting code), rubbish hills, buses and green text signs. A sign's text comes from the admin's list by a seeded roll, and the sign is a fence as wide as its posts. Hills are one to three overlapping heaps; slow noise groups them into ranges with open ground between, and they stay near the middle of their chunk so there is always a way between two of them. Trees and hills stop walkers and shots. Buses and signs stop walkers
  only. Rockets and enemy 5's ball pass over everything. A Rocketeer stands on each bus that comes near the view, never moves and can be killed. A kill keeps that bus empty for the rest of the run; walking far enough away despawns the Rocketeer, and it is back when the player returns. The Rocketeer and its rocket exist only on this map.
- Rocketeers launch guided rockets on the Kh-29's homing rules. Unlike a Kh-29, a rocket can be shot down by any bullet and is a target for the player's and companions' auto-aim, which counts it as nearer than it is. A click or tap also destroys it.
- A game runs in one of two modes, chosen on the start screen. Rescue is the original game. Endless has no hostage, no arena and no guardian boss: `s.hostage` is null and spawns never stop until the player dies. The boss can then appear, within its own spawn settings, as a regular enemy that uses its attack type and counts as a kill. Kills light no direction hint.
- The forest map (`scenery.js`) builds obstacles per 480 px chunk from a per-run seed: slow noise decides forest or open
  ground, jittered cells place trees, and each chunk rolls for wrecked tanks. Chunks are pure functions of the seed, so the
  cache can be dropped at any time and nothing is stored. Trees and tanks are circles to collision. Actors slide around
  them and big actors count as slim so they fit between trees. Bullets stop on them; enemy 5's ball does not. The start and
  the boss arena are kept clear.
- `enabled` on a role removes it from that map: spawns, the roster, the companion shop items, and for the boss the fight itself, so
  the hostage is free from the start.
- The difficulty level is `1 + floor(kills / difficultyKills)`. Each level adds `difficultyIncrease` percent of the base health,
  damage and XP. Spawns take the level they appear at; the boss is rescaled
  when the level changes, keeping its share of health. Projectiles gain damage. Speed and size never change. Each level also makes enemies spawn `difficultySpawnIncrease` percent more often (additive, default 10, at most three times the rate) and raises the map's most-at-once limit by the same factor, up to 120 unless the admin's own limit is higher. The score limits allow for the fastest rate, so the kill-rate check is three times looser than it was.
- The Su-34 is picked like any other spawn and is limited by its own settings. It flies a straight line past the
  player, launching a Kh-29 every `fireInterval` seconds while in view. Missiles home with a limited turn rate, ignore obstacles,
  expire after 8 seconds, and are ignored by bullets and auto-aim. Only a click or tap on one destroys it, which gives no kill
  and no XP.
- The hostage is placed at a random angle, 85 to 115% of `hostageDistance` from the start.
- Each map sets its own pacing (seconds between spawns, most enemies at once), and each character its own `spawnChance`. Each spawn picks one of Enemy 1, 2 and 5, the Su-34 and, in Endless, the boss in proportion to their rates, ignoring any that are off or not allowed yet, so a spawn is never wasted and 0.30 appears twice as often as 0.15. Each character also has its own seconds before its first spawn and most at once (0 means no limit); by default Enemy 5 waits 40 seconds and the Su-34 waits 60, with one at a time. On the wasteland these two settings hold back or limit the Rocketeers, and the buses stay. On the wasteland the Rocketeer's chance is how many map areas have a bus.
- Enemies appear just outside the view at intervals that shorten over time. Enemy 1 is a weighted rarity
  with more health and damage. Enemy 5 is rarer still. It walks like a melee enemy and every `fireInterval` seconds locks a line for half a second, then throws a ball
  whose texture, size, speed and damage come from that map's `ball` role. Enemies far behind the player despawn, which is what makes running
  away work.
- Every regular kill lights a wedge `hintSpread` degrees wide. Its centre is offset randomly by up to 40% of the
  width, so the true direction is always inside it, but never reliably in the middle.
- The companion spawns at `companionKills` kills or within `companionDistance` of the hostage, whichever is first, so
  it always arrives before the player does. When downed it returns after 9 seconds.
- Each enemy role has an `attackType`. Melee hits on contact. Kamikaze runs at its target and dies on contact, dealing its damage once, with no kill or XP unless a shot gets it first. It is not offered for the boss. The Boss attack makes an enemy fight the way the rescue boss does: a fan of bullets, a ring, a telegraphed charge, harder contact damage and faster attacks under half health, from shared code. It only opens fire on screen. Set on the boss it makes the Endless boss fight like the rescue boss, and changes nothing in Rescue. Sniper stops at long range, shows an aim line, locks its
  direction and fires one fast bullet. Pump closes in and fires a five-pellet spread. Ranged enemies only fire from inside
  the player's view and do no contact damage.
- The boss's attack type replaces its primary attack: pump is the fan plus the ring, sniper is single fast bullets, and
  melee fires nothing but charges more often. All three keep the charge.
- Destroyed regular enemies drop XP orbs (`xp` per role). Orbs drift to a nearby player and vanish if left far behind. Every
  `xpToUpgrade` XP banks one upgrade point and shows a notice; the game carries on and points wait until they are spent.
- The upgrade shop opens with B on a keyboard or the Shop button on phones. The page stops calling `step` while it is open, so the world is truly frozen, and the shop closes by itself when the last point is spent. `applyUpgrade` spends one point. Three sections (`SHOP_SECTIONS`):
  - Weapons: pump gun, a percentage more of base damage (additive), a percentage faster firing (additive), bullets piercing one more enemy.
  - Defense: more health, health replenishment (health per second, stacking), the personal laser, and laser upgrades for recharge, reach and bullets per shot. The laser burns the nearest enemy bullets within reach that are flying towards the player, then recharges. Enemy 5's large ball, rockets and Kh-29s are out of its scope.
  - Companions: the first companion, the second companion, and damage, fire rate and health upgrades shared by the whole team. Companion upgrades need a companion first, and the team stops at six of any mix.
- Upgrades belong to the run (`s.gun`, `s.companions`, `s.companionBoost`, `s.laser`, `player.maxHp`, `player.regen`) and never change the admin's config.
- The second companion (`companion2`) is a full role with its own name, image, sounds and stats on every map. It tends to be slower and tougher, with a harder but slower gun, and only ever joins from the shop.
- The boss sleeps until the player enters the arena or shoots it, cannot leave the arena, and heals if the player
  runs far enough to make it go home. Under half health its attacks speed up.
- The game is won only by touching the hostage after the boss is dead, and lost at zero player health.

## Leaderboard

The server records when each run starts (`POST /api/runs`, a one-time token stored only as a hash, in memory, 3 hour
life). When a run ends the browser posts the token, a name, the time, the kills and whether it was a win. Deaths appear only under most
kills and need at least one kill. The map comes from the token. Each map keeps its top 50 by shortest time and top 50 by most kills in `leaderboard.json`; the public view shows
ten of each. Open run tokens are written to `open-runs.json` on shutdown and read back once at start, so a deploy does not cost players
their run. A crash still loses them. Every rejected score logs why, without the name or token.

Endless runs rank separately, by most kills and longest run, and share the map's file. A run's mode comes from its token, like the map, and an Endless run cannot be a win. Rocketeers come on top of the spawn pacing, so on the wasteland the kill-rate limit also allows for the most buses a player could pass.

## Patch notes

The start and end screens have a Patch notes button that opens a scrolling list of every version and what changed. The notes are a static list in `public/js/patch-notes.js`, part of the page rather than the admin's config, and reach the page through `textContent` only.

## Sound

There are no built-in sounds. Each map's characters have upload slots (`SOUND_SLOTS`), and an empty slot is silent. The simulation emits `shot` and `kamikaze` events naming the role. `sound.js` turns these into one-shots that fade with distance, and each frame loops the idle sound of every role with an actor nearby and the boss theme while a boss is on screen. The theme keeps playing through the upgrade shop; idle sounds stop there, and pausing or the end of a run stops everything. Audio needs a user gesture, so the context starts on the first press.

Slots: player shoot; both companions idle and shoot; hostage idle; enemies, Su-34 and Rocketeer idle and shoot (a melee hit counts as the shoot sound); enemy 1 and 2 also have the kamikaze impact; boss theme only.

Sounds are stored by content hash in `sounds/`, and unreferenced files are removed on every commit like sprites. The admin's browser keeps MP3 as it is and converts anything else to WAV at the best quality under 16 MB. The server walks the structure, keeps only the audio frames or samples, and never decodes anything. Playback uses `fetch` and Web Audio, so the CSP has no media source.

## Page layout

`data-layout` on `<body>` is `mobile` for coarse pointers or narrow windows. Admin-chosen section order is applied
with CSS `order`. Desktop shows title and game, and opens the shop with B; mobile adds the panel with the move and aim sticks and a Shop button in the HUD. A phone in landscape puts one stick on
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
  go returns to auto-aim, so the game stays playable with one thumb or the keyboard alone. The Aim boss toggle in the HUD,
  remembered in `localStorage`, puts a boss ahead of every other auto-aim target for the player's own shots. It applies
  only on screen and within bullet flight, so it cannot point at the unseen Rescue boss and give the hostage away.
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
| Malicious audio uploads | Admin-only, 16 MB cap, only WAV (PCM) and MPEG Layer III accepted; each file is walked structurally and rebuilt from its samples or frames, so tags, extra chunks and trailing payloads are dropped; stored by hash; served with a fixed audio type, `nosniff` and a sandbox CSP |
| Path traversal | Sprite and sound paths come only from a validated SHA-256 name |
| Abuse and resource exhaustion | Per-IP rate limits, 64 KB JSON limit, capped sessions, pending logins and connections, request timeouts |
| Information leaks | Generic error bodies and sign-in messages; cookies, tokens and callback query strings are excluded from logs; `no-store` on private responses |
| Network interception | TLS on every hop; the proxy pins the container's certificate; the OIDC client verifies certificates; HSTS |
| Container escape, tampering | Non-root, read-only root, `cap_drop: ALL`, `no-new-privileges` |

Not covered: cheating. The game runs in the player's browser and has no scores or server-side state to protect.
Sign-out ends the session here but leaves the Authentik session alive, so that other applications stay signed in.
