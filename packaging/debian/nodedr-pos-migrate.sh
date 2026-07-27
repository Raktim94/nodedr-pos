#!/bin/sh
# Applies any pending Prisma migrations to the NodeDR POS database.
#
# Run from two places, deliberately:
#   - postinst, so a migration failure is visible at install time rather than
#     as a mysterious service that won't come up;
#   - ExecStartPre in nodedr-pos-backend.service, which covers the case where
#     the database is restored from a backup taken at an older schema.
# `prisma migrate deploy` only applies migrations not already recorded in
# _prisma_migrations, so running it twice is a no-op.
set -eu

# Resolved from this script's own location (it lives in <app>/bin), not
# hardcoded, so the exact same file works when it is run against a staging tree
# during the package build as it does from /opt after installation.
APP_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
CONF=/etc/nodedr-pos/nodedr-pos.conf
NODE="$APP_DIR/runtime/bin/node"
BACKEND="$APP_DIR/backend"

# When invoked by systemd the environment is already populated from the
# EnvironmentFile; when invoked from postinst it is not, so read it here too.
# The file is a systemd EnvironmentFile (plain KEY=value), which is a subset of
# what `.` can source safely.
#
# An explicitly exported DATABASE_URL wins over the file: an admin running this
# by hand against a copy of the database ("migrate this restored backup") must
# not have their target silently swapped for the live one.
_env_database_url="${DATABASE_URL:-}"
if [ -r "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi
[ -n "$_env_database_url" ] && DATABASE_URL="$_env_database_url"

: "${DATABASE_URL:=file:/var/lib/nodedr-pos/pos.db}"
export DATABASE_URL
export CHECKPOINT_DISABLE=1
export PRISMA_HIDE_UPDATE_MESSAGE=1

# Resolve the CLI entrypoint from the package manifest rather than hardcoding
# node_modules/prisma/build/index.js — that path is an internal detail that has
# moved between Prisma major versions.
PRISMA_CLI="$(
  "$NODE" -e '
    const path = require("path");
    const dir = process.argv[1];
    const pkg = require(path.join(dir, "package.json"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
    process.stdout.write(path.join(dir, bin));
  ' "$BACKEND/node_modules/prisma"
)"

cd "$BACKEND"
exec "$NODE" "$PRISMA_CLI" migrate deploy
