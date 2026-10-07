#!/usr/bin/env bash
# One-click installer for nodedr-pos.
#
# Run this from the repo root after cloning:
#   ./install.sh
#
# It builds the backend + frontend Docker images, starts the stack, waits
# for the backend to come up, then prints the URL to open.

set -euo pipefail

# --- 1. Check prerequisites -------------------------------------------------
# Docker Engine must be installed and the `docker compose` plugin available
# (it ships by default with current Docker Desktop / Docker Engine).
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed." >&2
  echo "Install it from https://docs.docker.com/get-docker/ and re-run this script." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: the 'docker compose' plugin was not found." >&2
  echo "Update Docker Desktop/Engine to a version that bundles Compose v2." >&2
  exit 1
fi

# --- 1b. Make sure the web port is free --------------------------------------
# Default is 1994. If something else already listens there (and it isn't this
# stack's own frontend, which `docker compose up` will simply recreate), pick
# the next free port and persist it in .env so later `docker compose` runs and
# the health check below agree with it.
port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1$"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

WANT_PORT="$(grep -m1 '^HOST_PORT=' .env 2>/dev/null | cut -d= -f2-)"
WANT_PORT="${WANT_PORT:-${HOST_PORT:-1994}}"
OWN_PORT="$(docker port nodedr-pos-frontend 3000/tcp 2>/dev/null | head -1 | sed 's/.*://')"

if [ "$WANT_PORT" != "$OWN_PORT" ] && port_in_use "$WANT_PORT"; then
  NEW_PORT="$WANT_PORT"
  while port_in_use "$NEW_PORT"; do NEW_PORT=$((NEW_PORT + 1)); done
  echo "Port ${WANT_PORT} is already in use by another program; using ${NEW_PORT} instead."
  touch .env
  sed -i '/^HOST_PORT=/d;/^FRONTEND_ORIGIN=/d' .env
  printf 'HOST_PORT=%s\nFRONTEND_ORIGIN=http://localhost:%s\n' "$NEW_PORT" "$NEW_PORT" >> .env
fi

# --- 2. Build the images and start the stack --------------------------------
# The SQLite database and the auto-generated session secret persist in the
# `nodedr-pos_data` Docker volume (declared in docker-compose.yml), which
# Compose creates automatically — nothing to set up on the host for this.
echo "Building nodedr-pos images and starting the stack (this can take a few minutes on first run)..."
docker compose up -d --build

# --- 3. Wait for the app to report healthy -----------------------------------
# The backend isn't published to the host; we probe it through the frontend's
# /api proxy on the same port the browser uses. Reads HOST_PORT from .env if
# present (see .env.example), so this works whether or not the default port
# was customized — nothing about this script assumes localhost-only.
HOST_PORT="$(grep -m1 '^HOST_PORT=' .env 2>/dev/null | cut -d= -f2-)"
HOST_PORT="${HOST_PORT:-1994}"

echo "Waiting for the app to come online..."
ready=false
for _ in $(seq 1 90); do
  if curl -sf "http://localhost:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done

if [ "$ready" != "true" ]; then
  echo "Warning: the app didn't respond within 90s. Check the logs with:" >&2
  echo "  docker compose logs" >&2
  exit 1
fi

# --- 4. Done ------------------------------------------------------------------
echo ""
echo "nodedr-pos is up and running."
echo "Open http://localhost:${HOST_PORT} in your browser to create your admin account and finish shop setup."
