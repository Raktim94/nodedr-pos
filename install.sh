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

# --- 2. Create the persistent data folder -----------------------------------
# This is where the SQLite database and the auto-generated session secret
# live, bind-mounted into the backend container so they survive rebuilds.
mkdir -p data

# --- 3. Build the images and start the stack --------------------------------
echo "Building nodedr-pos images and starting the stack (this can take a few minutes on first run)..."
docker compose up -d --build

# --- 4. Wait for the backend to report healthy -------------------------------
echo "Waiting for the backend to come online..."
ready=false
for _ in $(seq 1 60); do
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done

if [ "$ready" != "true" ]; then
  echo "Warning: the backend didn't respond within 60s. Check the logs with:" >&2
  echo "  docker compose logs backend" >&2
  exit 1
fi

# --- 5. Done ------------------------------------------------------------------
echo ""
echo "nodedr-pos is up and running."
echo "Open http://localhost:1994 in your browser to create your admin account and finish shop setup."
