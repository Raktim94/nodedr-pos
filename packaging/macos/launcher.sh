#!/bin/bash
# NodeDR POS.app launcher: starts the API + web UI + tray icon, then keeps the
# app alive until it is quit. Re-launching while it runs just opens the browser.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
RES="$HERE/Resources"
NODE="$RES/runtime/node"
DATA="$HOME/Library/Application Support/NodeDR POS"
LOGS="$HOME/Library/Logs/NodeDR POS"
FPORT=1994
BPORT=4000
mkdir -p "$DATA" "$LOGS"

up() { curl -fs "http://127.0.0.1:$BPORT/api/health" >/dev/null 2>&1; }
if up; then open "http://localhost:$FPORT"; exit 0; fi

export DATABASE_URL="file:$DATA/pos.db"
export PORT="$BPORT"
export FRONTEND_ORIGIN="http://localhost:$FPORT"
export NODE_ENV=production

# secret.js writes the JWT secret to <backend>/../data — point that at the data dir.
ln -sfn "$DATA" "$RES/data" 2>/dev/null || true

( cd "$RES/backend" && "$NODE" node_modules/.bin/prisma migrate deploy >>"$LOGS/migrate.log" 2>&1 ) || {
  osascript -e 'display alert "NodeDR POS could not update its database" message "See ~/Library/Logs/NodeDR POS/migrate.log"' ; exit 1; }

( cd "$RES/backend" && exec "$NODE" src/server.js >>"$LOGS/backend.log" 2>&1 ) &
BACK=$!
( cd "$RES/frontend" && PORT=$FPORT HOSTNAME=0.0.0.0 BACKEND_URL="http://127.0.0.1:$BPORT" exec "$NODE" server.js >>"$LOGS/frontend.log" 2>&1 ) &
FRONT=$!
( cd "$RES/tray" && exec "$NODE" tray.js >>"$LOGS/tray.log" 2>&1 ) &
TRAY=$!

for _ in $(seq 1 60); do up && break; sleep 0.5; done
open "http://localhost:$FPORT"

trap 'kill $BACK $FRONT $TRAY 2>/dev/null; exit 0' TERM INT
# If the API dies, exit so the tray's "Restart" (launchctl kickstart) or a
# re-launch brings everything back cleanly.
while kill -0 $BACK 2>/dev/null && kill -0 $FRONT 2>/dev/null; do sleep 2; done
kill $BACK $FRONT $TRAY 2>/dev/null
exit 1
