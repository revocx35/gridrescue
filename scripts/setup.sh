#!/bin/sh
# Prepares a checkout for `docker compose up -d`: a private .env and a self-signed certificate
# for the link between your reverse proxy and the container.
# Usage: scripts/setup.sh [extra-subject-alt-name ...]   e.g. scripts/setup.sh IP:10.0.0.5 DNS:game.lan
# Safe to re-run: existing .env and certificate files are left alone.
set -eu
cd "$(dirname "$0")/.."
umask 077

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env: fill in PUBLIC_URL, the OIDC_* values and ADMIN_GROUPS."
fi

mkdir -p certs
if [ ! -f certs/tls.key ]; then
  san="DNS:localhost"
  for extra in "$@"; do san="$san,$extra"; done
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -sha256 -days 3650 \
    -keyout certs/tls.key -out certs/tls.crt -subj "/CN=gridrescue" -addext "subjectAltName=$san" 2>/dev/null
  chmod 644 certs/tls.crt
  chmod 755 certs
  # The container runs as uid 1000 and must be able to read its key.
  if [ "$(id -u)" = 0 ]; then chown 1000:1000 certs/tls.key; chmod 400 certs/tls.key; else chmod 644 certs/tls.key; fi
  echo "Created certs/tls.crt for: $san"
fi
