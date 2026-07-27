#!/bin/bash
# nodedr-pos — operator front-end for the NodeDR POS system service.
#
# Wraps the handful of systemctl/journalctl invocations a shop owner or a
# sysadmin actually needs, so neither has to remember unit names.
set -uo pipefail

APP_DIR=/opt/nodedr-pos
CONF=/etc/nodedr-pos/nodedr-pos.conf
DATA_DIR=/var/lib/nodedr-pos
NODE="$APP_DIR/runtime/bin/node"
SERVICE=nodedr-pos.service
UNITS=(nodedr-pos.service nodedr-pos-backend.service nodedr-pos-frontend.service)

# Defaults mirror the shipped conffile; the file itself wins when readable.
PORT=1994
HOSTNAME_BIND=0.0.0.0
DATABASE_URL="file:$DATA_DIR/pos.db"
if [ -r "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
  HOSTNAME_BIND="${HOSTNAME:-$HOSTNAME_BIND}"
fi

DB_PATH="${DATABASE_URL#file:}"

say()  { printf '%s\n' "$*"; }
err()  { printf '%s\n' "$*" >&2; }
die()  { err "nodedr-pos: $*"; exit 1; }

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "'$1' needs root. Re-run with: sudo nodedr-pos $1${2:+ $2}"
  fi
}

url() {
  printf 'http://localhost:%s\n' "$PORT"
}

# Returns 0 as soon as the web port accepts a connection, 1 after the timeout.
# Uses bash's /dev/tcp so the package needs neither curl nor netcat.
wait_for_port() {
  local deadline=$(( SECONDS + ${1:-45} ))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
      exec 3>&- 2>/dev/null
      return 0
    fi
    sleep 1
  done
  return 1
}

cmd_open() {
  # Nudge the service up if it isn't running — the desktop launcher calls this,
  # and a user double-clicking the icon means "I want the POS", not "show me a
  # connection error".
  if ! systemctl is-active --quiet nodedr-pos-frontend.service; then
    if [ "$(id -u)" -eq 0 ]; then
      systemctl start "$SERVICE"
    else
      # pkexec/sudo may prompt; if the user declines we still try the browser
      # in case the service is up but the unit state is stale.
      systemctl start "$SERVICE" 2>/dev/null \
        || sudo -n systemctl start "$SERVICE" 2>/dev/null \
        || true
    fi
  fi

  if ! wait_for_port 45; then
    err "NodeDR POS is not responding on port $PORT."
    err "Check it with:  systemctl status nodedr-pos    (logs: nodedr-pos logs)"
    exit 1
  fi

  local target; target="$(url)"
  if command -v xdg-open >/dev/null 2>&1; then
    exec xdg-open "$target"
  elif command -v gio >/dev/null 2>&1; then
    exec gio open "$target"
  else
    say "Open this in your browser: $target"
  fi
}

cmd_status() {
  systemctl status --no-pager "${UNITS[@]}"
}

cmd_logs() {
  # Follow by default: the common case is "something just broke, show me".
  journalctl -u nodedr-pos-backend.service -u nodedr-pos-frontend.service \
    --no-pager -n "${1:-200}" -f
}

cmd_backup() {
  need_root backup
  local dest="${1:-$DATA_DIR/backups/pos-$(date +%Y%m%d-%H%M%S).db}"
  mkdir -p "$(dirname "$dest")"
  [ -f "$DB_PATH" ] || die "no database at $DB_PATH — has the POS been set up yet?"

  # VACUUM INTO is an online, crash-consistent copy: safe to run while the POS
  # is serving customers, unlike `cp` of a live SQLite file (which can capture
  # a torn page or miss an un-checkpointed WAL).
  "$NODE" -e '
    const Database = require(process.argv[1] + "/backend/node_modules/better-sqlite3");
    const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
    db.prepare("VACUUM INTO ?").run(process.argv[3]);
    db.close();
  ' "$APP_DIR" "$DB_PATH" "$dest" || die "backup failed"

  chmod 0600 "$dest"
  say "Backup written to $dest"
}

cmd_restore() {
  need_root restore "<file.db>"
  local src="${1:-}"
  [ -n "$src" ] || die "usage: nodedr-pos restore <backup.db>"
  [ -f "$src" ]  || die "no such file: $src"

  say "This replaces the live database at $DB_PATH."
  printf 'Type YES to continue: '
  local answer; read -r answer
  [ "$answer" = "YES" ] || die "aborted"

  systemctl stop "$SERVICE"
  if [ -f "$DB_PATH" ]; then
    local keep="$DB_PATH.replaced-$(date +%Y%m%d-%H%M%S)"
    mv "$DB_PATH" "$keep"
    say "Previous database kept at $keep"
  fi
  # -T: never write *into* the old path if it somehow still exists as a dir.
  cp -T "$src" "$DB_PATH"
  chown nodedr-pos:nodedr-pos "$DB_PATH"
  chmod 0640 "$DB_PATH"
  # A backup may predate the installed schema.
  "$APP_DIR/bin/nodedr-pos-migrate" >/dev/null || die "migrations failed on the restored database"
  systemctl start "$SERVICE"
  say "Restored. $(url)"
}

cmd_doctor() {
  local rc=0
  say "NodeDR POS health check"
  say "-----------------------"

  for unit in "${UNITS[@]}"; do
    if systemctl is-active --quiet "$unit"; then
      say "  [ ok ] $unit active"
    else
      say "  [FAIL] $unit is $(systemctl is-active "$unit" 2>/dev/null)"
      rc=1
    fi
  done

  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    exec 3>&- 2>/dev/null
    say "  [ ok ] web interface listening on $PORT (bind $HOSTNAME_BIND)"
  else
    say "  [FAIL] nothing listening on port $PORT"
    rc=1
  fi

  if (exec 3<>"/dev/tcp/127.0.0.1/${BACKEND_PORT:-4000}") 2>/dev/null; then
    exec 3>&- 2>/dev/null
    say "  [ ok ] API listening on loopback ${BACKEND_PORT:-4000}"
  else
    say "  [FAIL] API not listening on ${BACKEND_PORT:-4000}"
    rc=1
  fi

  if [ -f "$DB_PATH" ]; then
    say "  [ ok ] database $DB_PATH ($(du -h "$DB_PATH" 2>/dev/null | cut -f1))"
  else
    say "  [warn] no database yet at $DB_PATH — open $(url) to run first-time setup"
  fi

  if id -nG nodedr-pos 2>/dev/null | tr ' ' '\n' | grep -qx lp; then
    say "  [ ok ] service user is in the 'lp' group (USB printing permitted)"
  else
    say "  [warn] service user not in 'lp' group — USB thermal printing will fail"
  fi

  local lp_found=no
  for n in /dev/usb/lp0 /dev/usb/lp1 /dev/usb/lp2 /dev/usb/lp3 /dev/usblp0; do
    if [ -c "$n" ]; then
      say "  [ ok ] printer device $n present ($(stat -c '%U:%G %a' "$n" 2>/dev/null))"
      lp_found=yes
    fi
  done
  [ "$lp_found" = no ] && say "  [info] no USB printer device found (browser printing still works)"

  say ""
  say "Open the POS at: $(url)"
  [ "$rc" -ne 0 ] && say "Something is wrong — see: nodedr-pos logs"
  return "$rc"
}

cmd_version() {
  local v
  v="$(dpkg-query -W -f='${Version}' nodedr-pos 2>/dev/null)" || v="(not installed via dpkg)"
  say "NodeDR POS $v"
  say "Node runtime $("$NODE" -v 2>/dev/null || echo '(missing)')"
  say "Data directory $DATA_DIR"
}

usage() {
  cat <<EOF
NodeDR POS — offline point-of-sale

Usage: nodedr-pos <command>

  open                Open the POS in your browser (starts it if stopped)
  url                 Print the address to open
  start|stop|restart  Control the POS service            [root]
  status              Show service status
  logs [lines]        Follow the service logs
  doctor              Check ports, database and printer wiring
  backup [file]       Safe online copy of the database    [root]
  restore <file>      Replace the database from a backup  [root]
  version             Show installed versions

Configuration: $CONF   (restart after editing)
EOF
}

case "${1:-}" in
  open)            shift; cmd_open "$@" ;;
  url)             url ;;
  start)           need_root start;   systemctl start "$SERVICE"   && say "Started. $(url)" ;;
  stop)            need_root stop;    systemctl stop "$SERVICE"    && say "Stopped." ;;
  restart)         need_root restart; systemctl restart "$SERVICE" && say "Restarted. $(url)" ;;
  status)          cmd_status ;;
  logs)            shift; cmd_logs "$@" ;;
  doctor|check)    cmd_doctor ;;
  backup)          shift; cmd_backup "$@" ;;
  restore)         shift; cmd_restore "$@" ;;
  version|--version) cmd_version ;;
  ""|-h|--help|help) usage ;;
  *)               err "Unknown command: $1"; err ""; usage; exit 2 ;;
esac
