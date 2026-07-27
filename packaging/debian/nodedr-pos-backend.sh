#!/bin/sh
# Launcher for the NodeDR POS backend API.
#
# Exists for one reason: the backend and the web interface share a single
# EnvironmentFile (/etc/nodedr-pos/nodedr-pos.conf), and both read PORT. The
# web interface owns PORT (1994, the port a human types); the API listens on
# BACKEND_PORT. Mapping it here keeps one setting in one place instead of
# duplicating the port in two units that could drift apart.
set -eu

# Resolved from this script's own location (it lives in <app>/bin) so the build
# can boot the packaged tree as a self-test before shipping it.
APP_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
PORT="${BACKEND_PORT:-4000}"
export PORT

cd "$APP_DIR/backend"
exec "$APP_DIR/runtime/bin/node" "$APP_DIR/backend/src/server.js"
