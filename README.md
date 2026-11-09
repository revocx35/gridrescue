# Grid Rescue

A 2D rescue game on endless maps. Run from the enemies that hunt you, destroy them to light up the general
direction of the hostage, then defeat the boss guarding them. Plays with the keyboard on desktop and an on-screen
joystick on phones.

Nobody needs an account to play. An admin signs in through [Authentik](https://goauthentik.io/) to edit the game:

- two maps, each with its own name and its own full cast: name and image for the player, companion, hostage, enemy 1,
  enemy 2, enemy 3 (the boss), enemy 5 and the Su-34, plus the textures of enemy 5's large ball and the Kh-29 missile
- which characters appear on each map: everything but the player and hostage can be switched off
- the site menu: game title, tagline, button and end-screen text, colours, page order for desktop and mobile,
  joystick size and which side the movement stick is on
- each enemy's attack type: melee, sniper (one bullet) or pump (spread)
- XP dropped by each enemy, XP needed per upgrade, the size of the damage, fire rate and health upgrades
- how many kills raise the difficulty level and how much each level strengthens enemies
- the leaderboard: delete single scores or clear a map
- gameplay numbers: health, speed, damage, spawn rates, how far away the hostage is and how wide the hint is

## How it plays

| | |
|---|---|
| Move | WASD or arrow keys, or the left joystick |
| Attack | Automatic: you and your companion fire at the nearest enemy in range. Hold the right joystick on phones, or the left mouse button on desktop, to aim yourself |
| Find the hostage | Every enemy you destroy briefly lights a wedge of the grid. The hostage is somewhere inside it |
| Maps | Choose on the start screen. The Grid is open floor; the forest map is full of trees and exploded tanks that block movement and bullets |
| Enemy 5 | The strongest and rarest enemy. Throws a large ball every 3 seconds that rolls through cover |
| Su-34 | Very rare. Crosses the screen firing guided Kh-29 missiles, which chase you until you click or tap them, or they run out of fuel. Bullets pass through them |
| Difficulty | Every 25 kills raises the level. Enemies gain 10% health, damage and XP per level, but no speed or size |
| Companion | Joins after enough kills, or as you get close to the hostage, whichever comes first |
| Upgrades | Destroyed enemies drop XP. Every 200 XP the game freezes and you pick one: pump gun, 20% more damage, 20% faster firing, more health, one more companion, or bullets that pass through one more enemy |
| Win | Defeat the boss, then reach the hostage |
| Leaderboard | Enter a name when a run ends to join the global tables for that map. Wins count for fastest rescue and most kills; deaths with at least one kill count for most kills |

## Run it

You need Docker with Compose and an Authentik instance.

1. In Authentik, create an **OAuth2/OpenID** provider (confidential client, authorization code grant, RS256 signing
   key, scopes `openid`, `profile`, `email`). Set the redirect URI to `<your address>/auth/callback`. Create an
   application for it and note which group should be allowed to edit the game.
2. Prepare the checkout, passing the name or IP your reverse proxy uses to reach this machine:

   ```sh
   scripts/setup.sh IP:10.0.0.5
   ```

3. Fill in `.env` (`PUBLIC_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `ADMIN_GROUPS`, `TRUST_PROXY`).
4. Start it:

   ```sh
   docker compose up -d --build
   ```

5. Point your reverse proxy at `https://<this machine>:8443` and open `<your address>/admin` to sign in.

Names, images and settings live in the `data` volume and survive upgrades. Any image the admin's browser can open
(JPG, PNG, WebP, GIF, SVG and others) can be used as a sprite; it is converted to a PNG of at most 1024 px on upload.

### Reverse proxy

The container speaks HTTPS with a self-signed certificate, which the proxy should pin. For nginx or Nginx Proxy
Manager (advanced config), after copying `certs/tls.crt` somewhere nginx can read it:

```nginx
client_max_body_size 4m;
proxy_ssl_verify on;
proxy_ssl_trusted_certificate /path/to/tls.crt;
proxy_ssl_name localhost;
proxy_ssl_server_name on;
```

`proxy_ssl_name localhost` is deliberate: nginx cannot check IP entries in a certificate, and only the pinned
certificate is trusted anyway. Do not put authentication in front of the site, because the game is public; the app
protects `/admin` itself. Also restrict the published port so that only the proxy can reach it.

## Develop

```sh
npm ci
npm test
```
