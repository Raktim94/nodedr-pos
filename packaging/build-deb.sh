#!/usr/bin/env bash
#
# build-deb.sh — build a standalone NodeDR POS .deb for Debian/Ubuntu.
#
# Takes a clean checkout of the project, builds the Next.js production assets
# and the backend's production dependencies, bundles a Node.js runtime, lays
# out the Debian package tree and emits nodedr-pos_<version>_<arch>.deb.
#
# It never touches your working tree: the sources are cloned into a temporary
# directory, and every build artefact stays there. The Docker Compose
# deployment is completely unaffected by this script.
#
#   ./packaging/build-deb.sh                        # build from HEAD of this repo
#   ./packaging/build-deb.sh --version 1.0.1
#   ./packaging/build-deb.sh --source https://github.com/Raktim94/nodedr-pos.git
#   ./packaging/build-deb.sh --help
#
set -Eeuo pipefail

# --------------------------------------------------------------------------
# Defaults
# --------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$SCRIPT_DIR/debian"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

PKG_NAME="nodedr-pos"
VERSION="1.0.0"
DEB_REVISION=""                       # appended as -N when set
SOURCE="$REPO_ROOT"
REF="HEAD"
FROM_WORKTREE=0
OUTDIR="$REPO_ROOT/dist"
NODE_VERSION="24.18.0"                # matches the node:24 base image the
                                      # Docker deployment already uses
SYSTEM_NODE=0
FRONTEND_PORT="1994"
BACKEND_PORT="4000"
MAINTAINER="Raktim <ranjitraktim5@gmail.com>"
KEEP_WORK=0
PRUNE=1
SELFTEST=1
DEB_ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<EOF

Options:
  --version <v>        Upstream version                 (default: $VERSION)
  --revision <n>       Debian revision, e.g. 1 -> 1.0.0-1
  --source <path|url>  Repository to build from         (default: this repo)
  --ref <ref>          Branch/tag/commit to build       (default: $REF)
  --from-worktree      Copy the working tree instead of cloning a clean ref
  --arch <arch>        Debian architecture              (default: $DEB_ARCH)
  --outdir <dir>       Where to write the .deb          (default: $OUTDIR)
  --node-version <v>   Node.js to bundle                (default: $NODE_VERSION)
  --system-node        Depend on the distro nodejs package instead of bundling
  --port <n>           Port the web interface listens on (default: $FRONTEND_PORT)
  --backend-port <n>   Loopback port for the API        (default: $BACKEND_PORT)
  --maintainer <s>     Maintainer field                 (default: $MAINTAINER)
  --keep               Keep the temporary build directory for inspection
  --no-prune           Keep node-gyp build residue in the payload (~30MB larger)
  --no-selftest        Skip booting the packaged app before building the .deb
  -h, --help           This help

Requires: dpkg-deb, git, tar, xz, curl (or wget), and a C/C++ toolchain only if
npm cannot find prebuilt binaries for better-sqlite3 / usb.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)       VERSION="$2"; shift 2 ;;
    --revision)      DEB_REVISION="$2"; shift 2 ;;
    --source)        SOURCE="$2"; shift 2 ;;
    --ref)           REF="$2"; shift 2 ;;
    --from-worktree) FROM_WORKTREE=1; shift ;;
    --arch)          DEB_ARCH="$2"; shift 2 ;;
    --outdir)        OUTDIR="$2"; shift 2 ;;
    --node-version)  NODE_VERSION="$2"; shift 2 ;;
    --system-node)   SYSTEM_NODE=1; shift ;;
    --port)          FRONTEND_PORT="$2"; shift 2 ;;
    --backend-port)  BACKEND_PORT="$2"; shift 2 ;;
    --maintainer)    MAINTAINER="$2"; shift 2 ;;
    --keep)          KEEP_WORK=1; shift ;;
    --no-prune)      PRUNE=0; shift ;;
    --no-selftest)   SELFTEST=0; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

FULL_VERSION="$VERSION${DEB_REVISION:+-$DEB_REVISION}"
DEB_FILE="$OUTDIR/${PKG_NAME}_${FULL_VERSION}_${DEB_ARCH}.deb"

# --------------------------------------------------------------------------
# Output helpers
# --------------------------------------------------------------------------
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
else B=""; G=""; Y=""; R=""; N=""; fi

step()  { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
info()  { printf '    %s\n' "$*"; }
ok()    { printf '    %s✓%s %s\n' "$G" "$N" "$*"; }
warn()  { printf '    %s!%s %s\n' "$Y" "$N" "$*" >&2; }
die()   { printf '\n%sERROR:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# --------------------------------------------------------------------------
# Preflight
# --------------------------------------------------------------------------
step "Preflight"

for tool in dpkg-deb git tar; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is required. Install it with: sudo apt-get install -y dpkg-dev git tar"
done

DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then DOWNLOADER=curl
elif command -v wget >/dev/null 2>&1; then DOWNLOADER=wget
fi
[ -n "$DOWNLOADER" ] || die "need curl or wget to download the Node.js runtime"

[ -d "$PKG_DIR" ] || die "packaging templates not found at $PKG_DIR"

# Debian arch -> Node.js distribution arch. Native modules are compiled during
# the build, so the build host must be the same architecture as the target;
# there is no cross-compilation path here.
case "$DEB_ARCH" in
  amd64) NODE_ARCH="x64"   ;;
  arm64) NODE_ARCH="arm64" ;;
  armhf) NODE_ARCH="armv7l";;
  *)     die "unsupported architecture '$DEB_ARCH' (supported: amd64, arm64, armhf)" ;;
esac

HOST_ARCH="$(dpkg --print-architecture 2>/dev/null || echo unknown)"
if [ "$HOST_ARCH" != "$DEB_ARCH" ]; then
  die "cannot build $DEB_ARCH on a $HOST_ARCH host: better-sqlite3 and usb are
       native modules that must be built/downloaded for the target ABI. Run this
       script on a $DEB_ARCH machine (or an emulated container of one)."
fi

info "package        $PKG_NAME $FULL_VERSION ($DEB_ARCH)"
info "source         $SOURCE @ $REF"
if [ "$SYSTEM_NODE" -eq 1 ]; then
  info "node runtime   system nodejs package (not bundled)"
else
  info "node runtime   bundled v$NODE_VERSION ($NODE_ARCH)"
fi
info "web port       $FRONTEND_PORT   api port (loopback) $BACKEND_PORT"
ok "preflight passed"

WORK="$(mktemp -d -t nodedr-pos-deb.XXXXXXXX)"
cleanup() {
  if [ "$KEEP_WORK" -eq 1 ]; then
    printf '\n    build directory kept at %s\n' "$WORK"
  else
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

SRC="$WORK/src"
ROOT="$WORK/root"          # the future filesystem root of the package
APP_DIR="$ROOT/opt/$PKG_NAME"

# --------------------------------------------------------------------------
# 1. Clean checkout
# --------------------------------------------------------------------------
step "Fetching a clean checkout of the application"

if [ "$FROM_WORKTREE" -eq 1 ]; then
  [ -d "$SOURCE" ] || die "--from-worktree needs a local directory as --source"
  mkdir -p "$SRC"
  # Exclude everything that is either huge, machine-specific, or regenerated
  # by this script anyway.
  tar -C "$SOURCE" \
      --exclude=.git --exclude=node_modules --exclude=.next \
      --exclude=dist --exclude=data --exclude='*.tsbuildinfo' \
      -cf - . | tar -C "$SRC" -xf -
  warn "building from the working tree, including uncommitted changes"
else
  git clone --quiet --depth 1 --branch "$REF" "$SOURCE" "$SRC" 2>/dev/null \
    || git clone --quiet "$SOURCE" "$SRC"
  if [ "$REF" != "HEAD" ]; then
    git -C "$SRC" checkout --quiet "$REF" 2>/dev/null || true
  fi
fi

[ -f "$SRC/backend/package.json" ]  || die "no backend/package.json in the checkout — is --source pointing at the nodedr-pos repository?"
[ -f "$SRC/frontend/package.json" ] || die "no frontend/package.json in the checkout"

GIT_DESC="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
ok "checked out $GIT_DESC"

# --------------------------------------------------------------------------
# 2. Node.js runtime
# --------------------------------------------------------------------------
step "Preparing the Node.js runtime"

NODE_DIST="node-v${NODE_VERSION}-linux-${NODE_ARCH}"
NODE_TARBALL="$NODE_DIST.tar.xz"
NODE_BASE_URL="https://nodejs.org/dist/v${NODE_VERSION}"
NODE_HOME="$WORK/$NODE_DIST"

fetch() {   # fetch <url> <dest>
  case "$DOWNLOADER" in
    curl) curl -fsSL --retry 3 --connect-timeout 20 -o "$2" "$1" ;;
    wget) wget -q -t 3 -O "$2" "$1" ;;
  esac
}

# A local cache keeps repeat builds (and CI reruns) from re-downloading ~50MB.
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/nodedr-pos-deb"
mkdir -p "$CACHE_DIR"

if [ ! -f "$CACHE_DIR/$NODE_TARBALL" ]; then
  info "downloading $NODE_TARBALL"
  fetch "$NODE_BASE_URL/$NODE_TARBALL" "$CACHE_DIR/$NODE_TARBALL.part" \
    || die "could not download Node.js v$NODE_VERSION — check the version exists at $NODE_BASE_URL/"
  mv "$CACHE_DIR/$NODE_TARBALL.part" "$CACHE_DIR/$NODE_TARBALL"
else
  info "using cached $NODE_TARBALL"
fi

# Verify against upstream's published checksums. This is the one artefact in
# the package that is not built from source here, so it does not go in
# unverified.
info "verifying SHA-256 against nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
if fetch "$NODE_BASE_URL/SHASUMS256.txt" "$WORK/SHASUMS256.txt"; then
  EXPECTED="$(awk -v f="$NODE_TARBALL" '$2 == f { print $1 }' "$WORK/SHASUMS256.txt")"
  [ -n "$EXPECTED" ] || die "$NODE_TARBALL is not listed in upstream SHASUMS256.txt"
  ACTUAL="$(sha256sum "$CACHE_DIR/$NODE_TARBALL" | awk '{print $1}')"
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    rm -f "$CACHE_DIR/$NODE_TARBALL"
    die "checksum mismatch for $NODE_TARBALL (cached copy deleted; re-run to download again)
       expected $EXPECTED
       actual   $ACTUAL"
  fi
  ok "checksum verified"
else
  die "could not fetch SHASUMS256.txt — refusing to bundle an unverified runtime"
fi

tar -C "$WORK" -xf "$CACHE_DIR/$NODE_TARBALL"
[ -x "$NODE_HOME/bin/node" ] || die "extracted Node.js runtime has no bin/node"

# Guard against exactly the failure mode that shipped once already during
# development: Node 26's official binary started linking libatomic.so.1,
# which Node 24's did not, and a minimal Debian/Ubuntu install does not have
# it — the bundled node binary would fail at service start with "error while
# loading shared libraries", discovered only by actually running the package.
# Every .so this binary needs must be satisfiable by something this script's
# Depends line (below) declares; if upstream Node links a new one on some
# future version bump, fail the BUILD, not a customer's install.
if command -v ldd >/dev/null 2>&1; then
  info "checking the bundled node binary's shared library dependencies"
  # Satisfied by libc6 + libstdc++6 + libatomic1 (see Depends below), or not a
  # real dependency at all (the vDSO and the dynamic linker itself).
  COVERED_LIBS="libc.so.6 libdl.so.2 libm.so.6 libpthread.so.0 libgcc_s.so.1 libstdc++.so.6 libatomic.so.1 linux-vdso.so.1 ld-linux-x86-64.so.2 ld-linux-aarch64.so.1 ld-linux-armhf.so.3"
  UNCOVERED=""
  while read -r lib; do
    [ -z "$lib" ] && continue
    # The dynamic linker's own line (`/lib64/ld-linux-x86-64.so.2 (0x...)`) has
    # no `=>`, so awk's $1 is a full path there but a bare filename for every
    # other line — normalize both to a basename before comparing.
    lib="$(basename "$lib")"
    case " $COVERED_LIBS " in
      *" $lib "*) ;;
      *) UNCOVERED="$UNCOVERED $lib" ;;
    esac
  done <<EOF
$(ldd "$NODE_HOME/bin/node" | awk '{print $1}')
EOF
  if [ -n "$UNCOVERED" ]; then
    die "the bundled node binary links a library this package does not declare
       a Depends for:$UNCOVERED
       Add the Debian package that provides it to DEPENDS below, and add the
       .so name to COVERED_LIBS in this script so this check passes next time."
  fi
  ok "no undeclared shared library dependencies"
else
  warn "ldd not available on this build host — skipping the shared-library dependency check"
fi

# Everything from here on builds with the bundled toolchain, so the native
# modules match the ABI of the Node binary that will actually run them in
# production. This is the whole reason the runtime is bundled.
export PATH="$NODE_HOME/bin:$PATH"
export npm_config_update_notifier=false
export NPM_CONFIG_FUND=false
export NPM_CONFIG_AUDIT=false
export NEXT_TELEMETRY_DISABLED=1
export CHECKPOINT_DISABLE=1
export CI=1

ok "node $(node -v), npm $(npm -v)"

# --------------------------------------------------------------------------
# 3. Backend: production dependencies + Prisma client
# --------------------------------------------------------------------------
step "Building the backend"

cd "$SRC/backend"

# `npm ci` (not `npm install`): reproducible, exactly the locked versions.
# Dev dependencies are kept because the only one is the Prisma CLI, which the
# package needs at runtime to apply migrations on install and on upgrade.
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  warn "no package-lock.json — falling back to npm install (not reproducible)"
  npm install --no-audit --no-fund
fi

info "generating the Prisma client"
npx --no-install prisma generate >/dev/null

# The two native addons are the single most likely thing to break a build on a
# new distro or architecture, and they fail at *runtime* rather than at install
# time if the ABI is wrong. Prove they load under the exact binary that will
# run them in production.
info "verifying native modules load under the bundled runtime"
node -e '
  const mods = ["better-sqlite3", "usb", "@prisma/client", "@prisma/adapter-better-sqlite3"];
  for (const m of mods) {
    try { require(m); }
    catch (e) { console.error("FAILED to load " + m + ": " + e.message); process.exit(1); }
  }
' || die "a required native module does not load. If this is a fresh distro/arch,
       prebuilt binaries may be unavailable — install a toolchain and retry:
         sudo apt-get install -y build-essential python3 pkg-config libudev-dev"
ok "backend dependencies built and verified"

# The backend keeps its one dev dependency, the Prisma CLI, because the package
# needs `migrate deploy` at install and at upgrade time — on a till with no
# network, so it cannot be fetched on demand.
#
# That CLI's dependency tree is NOT pruned, and the attempt is documented here
# so nobody repeats it. `prisma/build/index.js` is a single bundled file that
# eagerly requires its entire dependency set at load time, including Prisma
# Studio's web UI (`@prisma/studio-core/data/bff`) and `effect` by way of
# `@prisma/config`, which parses prisma.config.js. Removing any of them makes
# `migrate deploy` die with MODULE_NOT_FOUND, which would abort postinst on
# every single installation. Both attempts were caught by the self-test in
# step 6 rather than by a customer.
#
# The alternative — dropping the CLI and hand-rolling a migration runner over
# the migration SQL — was rejected deliberately: it means reimplementing
# Prisma's _prisma_migrations bookkeeping (row format and checksum algorithm)
# for an application that handles money. Roughly 180MB of disk on a
# single-purpose machine is the cheaper side of that trade.
#
# What IS pruned below is only build residue with no possible runtime role.
if [ "$PRUNE" -eq 1 ]; then
  step "Pruning build residue from the payload"
  cd "$SRC/backend/node_modules"
  BEFORE_KB="$(du -sk . | cut -f1)"

  # better-sqlite3 ships the SQLite amalgamation sources and every node-gyp
  # intermediate alongside the compiled addon. Only the addon is loaded.
  rm -rf better-sqlite3/deps better-sqlite3/src better-sqlite3/binding.gyp
  find better-sqlite3/build -mindepth 1 -maxdepth 1 ! -name Release -exec rm -rf {} + 2>/dev/null || true
  find better-sqlite3/build/Release -mindepth 1 ! -name 'better_sqlite3.node' -exec rm -rf {} + 2>/dev/null || true

  # `usb` ships prebuilt addons for every platform it supports; keep this one.
  if [ -d usb/prebuilds ]; then
    find usb/prebuilds -mindepth 1 -maxdepth 1 ! -name "linux-${NODE_ARCH}" -exec rm -rf {} + 2>/dev/null || true
  fi
  rm -rf usb/test usb/src usb/libusb

  AFTER_KB="$(du -sk . | cut -f1)"
  ok "build residue pruned: $((BEFORE_KB / 1024))MB -> $((AFTER_KB / 1024))MB"
  cd "$SRC/backend"
else
  info "pruning disabled (--no-prune)"
fi

# --------------------------------------------------------------------------
# 4. Frontend: Next.js standalone production build
# --------------------------------------------------------------------------
step "Building the frontend (Next.js production build)"

cd "$SRC/frontend"

if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  warn "no package-lock.json — falling back to npm install (not reproducible)"
  npm install --no-audit --no-fund
fi

# CRITICAL: Next.js resolves rewrite destinations at BUILD time into the routes
# manifest — a runtime BACKEND_URL is silently ignored and the proxy falls back
# to the default. That is the same trap the Docker build avoids with a build
# ARG. Here the destination is loopback, because in this deployment the API is
# a local service rather than a container on a bridge network.
export BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
info "baking API proxy destination: $BACKEND_URL"

npm run build

[ -d .next/standalone ] || die "Next.js did not produce .next/standalone — is output:'standalone' still set in next.config.ts?"

# Prove the baked destination actually landed in the manifest rather than
# trusting that the env var was picked up.
if ! grep -qF "127.0.0.1:${BACKEND_PORT}" .next/routes-manifest.json 2>/dev/null; then
  die "the /api proxy destination was NOT baked into .next/routes-manifest.json.
       The package would 502 on every API call. Check next.config.ts rewrites."
fi
ok "frontend built, /api proxy destination verified in the routes manifest"

# --------------------------------------------------------------------------
# 5. Lay out the package filesystem
# --------------------------------------------------------------------------
step "Laying out the package tree"

mkdir -p "$APP_DIR"/{backend,frontend,bin} \
         "$ROOT/etc/$PKG_NAME" \
         "$ROOT/usr/bin" \
         "$ROOT/usr/lib/systemd/system" \
         "$ROOT/usr/lib/udev/rules.d" \
         "$ROOT/usr/share/applications" \
         "$ROOT/usr/share/doc/$PKG_NAME" \
         "$ROOT/usr/share/pixmaps"

# --- 5a. Node runtime ---
if [ "$SYSTEM_NODE" -eq 0 ]; then
  mkdir -p "$APP_DIR/runtime/bin"
  cp -a "$NODE_HOME/bin/node" "$APP_DIR/runtime/bin/node"
  # Upstream's license text must ship with the binary (see debian/copyright).
  cp -a "$NODE_HOME/LICENSE" "$APP_DIR/runtime/LICENSE"
  # npm, npx, corepack, headers and manpages are build-time only — dropping
  # them takes the bundled runtime from ~120MB to ~110MB and removes a package
  # manager from a production till.
  ok "bundled node $(node -v) ($(du -sh "$APP_DIR/runtime" | cut -f1))"
else
  # A shim so every unit file, helper and the CLI can keep referring to one
  # fixed interpreter path regardless of how Node was provided.
  mkdir -p "$APP_DIR/runtime/bin"
  cat > "$APP_DIR/runtime/bin/node" <<'SHIM'
#!/bin/sh
# Built with --system-node: delegate to the distribution's Node.js so that the
# rest of the package does not need to care which one is in use.
for candidate in /usr/bin/node /usr/bin/nodejs /usr/local/bin/node; do
  [ -x "$candidate" ] && exec "$candidate" "$@"
done
echo "nodedr-pos: no system Node.js found (expected /usr/bin/node)" >&2
exit 1
SHIM
  chmod 0755 "$APP_DIR/runtime/bin/node"
  warn "--system-node: native modules were built against $(node -v);
       the distro's nodejs must expose the same ABI (NODE_MODULE_VERSION $(node -p 'process.versions.modules')) or the service will not start"
fi

# --- 5b. Backend ---
cp -a "$SRC/backend/src"              "$APP_DIR/backend/src"
cp -a "$SRC/backend/prisma"           "$APP_DIR/backend/prisma"
cp -a "$SRC/backend/node_modules"     "$APP_DIR/backend/node_modules"
cp -a "$SRC/backend/package.json"     "$APP_DIR/backend/package.json"
# Prisma 7 keeps the Migrate/CLI connection URL here rather than in
# schema.prisma. Forgetting to ship it produces a service that crash-loops on
# `migrate deploy` — the exact failure the Docker build hit once.
cp -a "$SRC/backend/prisma.config.js" "$APP_DIR/backend/prisma.config.js"
[ -f "$APP_DIR/backend/prisma.config.js" ] || die "prisma.config.js is missing from the payload"

# src/lib/secret.js writes the JWT signing secret to <backend>/../data — a path
# relative to the source file that cannot be configured by environment. The
# symlink redirects it (and anything else resolving through data/) into the
# state directory, without patching upstream code.
ln -s /var/lib/nodedr-pos "$APP_DIR/backend/data"

# --- 5c. Frontend ---
cp -a "$SRC/frontend/.next/standalone/." "$APP_DIR/frontend/"
mkdir -p "$APP_DIR/frontend/.next"
cp -a "$SRC/frontend/.next/static"       "$APP_DIR/frontend/.next/static"
if [ -d "$SRC/frontend/public" ]; then
  cp -a "$SRC/frontend/public"           "$APP_DIR/frontend/public"
else
  mkdir -p "$APP_DIR/frontend/public"
fi
[ -f "$APP_DIR/frontend/server.js" ] || die "standalone server.js missing from the frontend payload"

# /opt is read-only under ProtectSystem=strict, so Next's runtime cache is
# redirected to a state directory it is allowed to write.
ln -s /var/cache/nodedr-pos/next "$APP_DIR/frontend/.next/cache"

# --- 5d. Helper executables ---
install -m 0755 "$PKG_DIR/nodedr-pos-backend.sh" "$APP_DIR/bin/nodedr-pos-backend"
install -m 0755 "$PKG_DIR/nodedr-pos-migrate.sh" "$APP_DIR/bin/nodedr-pos-migrate"
install -m 0755 "$PKG_DIR/nodedr-pos.cli.sh"     "$ROOT/usr/bin/nodedr-pos"

# --- 5e. systemd, udev, desktop ---
install -m 0644 "$PKG_DIR/nodedr-pos.service"          "$ROOT/usr/lib/systemd/system/nodedr-pos.service"
install -m 0644 "$PKG_DIR/nodedr-pos-backend.service"  "$ROOT/usr/lib/systemd/system/nodedr-pos-backend.service"
install -m 0644 "$PKG_DIR/nodedr-pos-frontend.service" "$ROOT/usr/lib/systemd/system/nodedr-pos-frontend.service"
install -m 0644 "$PKG_DIR/60-nodedr-pos-printer.rules" "$ROOT/usr/lib/udev/rules.d/60-nodedr-pos-printer.rules"
install -m 0644 "$PKG_DIR/nodedr-pos.desktop"          "$ROOT/usr/share/applications/nodedr-pos.desktop"
install -m 0644 "$PKG_DIR/nodedr-pos.conf"             "$ROOT/etc/$PKG_NAME/nodedr-pos.conf"

# Apply the requested ports to the shipped configuration.
sed -i -e "s/^PORT=.*/PORT=${FRONTEND_PORT}/" \
       -e "s/^BACKEND_PORT=.*/BACKEND_PORT=${BACKEND_PORT}/" \
       -e "s#^FRONTEND_ORIGIN=.*#FRONTEND_ORIGIN=http://localhost:${FRONTEND_PORT}#" \
       "$ROOT/etc/$PKG_NAME/nodedr-pos.conf"

# --- 5f. Icon ---
LOGO="$SRC/Nodedr pos logo.png"
if [ -f "$LOGO" ]; then
  if command -v ffmpeg >/dev/null 2>&1; then
    for size in 512 256 128 64 48 32; do
      dir="$ROOT/usr/share/icons/hicolor/${size}x${size}/apps"
      mkdir -p "$dir"
      ffmpeg -hide_banner -loglevel error -y -i "$LOGO" \
             -vf "scale=${size}:${size}:flags=lanczos" \
             -frames:v 1 "$dir/$PKG_NAME.png" 2>/dev/null || true
    done
    ok "icon installed at 6 sizes"
  fi
  # A pixmaps copy makes the launcher work on desktops that never look at the
  # hicolor theme, and is the fallback when no resizer is available.
  cp -a "$LOGO" "$ROOT/usr/share/pixmaps/$PKG_NAME.png"
  chmod 0644 "$ROOT/usr/share/pixmaps/$PKG_NAME.png"
else
  warn "logo not found in the checkout — the launcher will use a generic icon"
fi

# --- 5g. Documentation ---
install -m 0644 "$PKG_DIR/copyright"     "$ROOT/usr/share/doc/$PKG_NAME/copyright"
install -m 0644 "$PKG_DIR/README.Debian" "$ROOT/usr/share/doc/$PKG_NAME/README.Debian"
[ -f "$SRC/README.md" ] && install -m 0644 "$SRC/README.md" "$ROOT/usr/share/doc/$PKG_NAME/README.md"

cat > "$WORK/changelog.Debian" <<EOF
$PKG_NAME ($FULL_VERSION) stable; urgency=medium

  * Native Debian package: runs as a systemd service, no Docker required.
  * Bundles its own Node.js runtime so the package does not depend on, or
    conflict with, any system nodejs installation.
  * Built from $PKG_NAME commit $GIT_DESC.

 -- $MAINTAINER  $(date -R)
EOF
gzip -9n -c "$WORK/changelog.Debian" > "$ROOT/usr/share/doc/$PKG_NAME/changelog.Debian.gz"
chmod 0644 "$ROOT/usr/share/doc/$PKG_NAME/changelog.Debian.gz"

ok "package tree laid out"

# --------------------------------------------------------------------------
# 6. Self-test: run the packaged application before shipping it
# --------------------------------------------------------------------------
# Everything up to here proves the *build* worked. This proves the *payload*
# works: it exercises the exact files that will land in /opt on a till, using
# the exact Node binary that will run them. It is what catches a missing
# prisma.config.js, an over-eager prune, a proxy destination that never got
# baked in, or a native module with the wrong ABI — all of which otherwise
# surface as a crash-looping service on someone else's machine.
if [ "$SELFTEST" -eq 1 ]; then
  step "Self-test: booting the packaged application"

  ST="$WORK/selftest"
  mkdir -p "$ST/data" "$ST/cache"

  # The payload contains two absolute symlinks (/var/lib and /var/cache) that
  # do not exist on a build host. Point them at scratch directories for the
  # duration of the test, then put them back exactly as they were.
  rm -f "$APP_DIR/backend/data" "$APP_DIR/frontend/.next/cache"
  ln -s "$ST/data"  "$APP_DIR/backend/data"
  ln -s "$ST/cache" "$APP_DIR/frontend/.next/cache"

  restore_symlinks() {
    rm -rf "$APP_DIR/backend/data" "$APP_DIR/frontend/.next/cache"
    ln -s /var/lib/nodedr-pos            "$APP_DIR/backend/data"
    ln -s /var/cache/nodedr-pos/next     "$APP_DIR/frontend/.next/cache"
  }

  ST_BACKEND_PID=""
  ST_FRONTEND_PID=""
  selftest_cleanup() {
    [ -n "$ST_BACKEND_PID" ]  && kill "$ST_BACKEND_PID"  2>/dev/null || true
    [ -n "$ST_FRONTEND_PID" ] && kill "$ST_FRONTEND_PID" 2>/dev/null || true
    # The launcher `exec`s node, and bash may or may not have exec'd the
    # subshell, so $! is not reliably the node process. Match on the build's
    # own temp path, which no other process on the machine can share.
    pkill -f "$APP_DIR/backend/src/server.js" 2>/dev/null || true
    pkill -f "$APP_DIR/frontend/server.js"    2>/dev/null || true
    restore_symlinks
  }
  trap 'selftest_cleanup; cleanup' EXIT

  NODE_BIN="$APP_DIR/runtime/bin/node"
  [ "$SYSTEM_NODE" -eq 1 ] && NODE_BIN="$(command -v node)"

  export DATABASE_URL="file:$ST/data/pos.db"
  export JWT_SECRET="selftest-only-not-shipped"
  export FRONTEND_ORIGIN="http://127.0.0.1:$FRONTEND_PORT"
  export COOKIE_SECURE=false

  # --- 6a. Migrations against a scratch database --------------------------
  info "applying migrations to a scratch database"
  ( cd "$APP_DIR/backend" && "$APP_DIR/bin/nodedr-pos-migrate" ) >"$ST/migrate.log" 2>&1 \
    || { sed 's/^/      /' "$ST/migrate.log" >&2; die "migrations failed against the packaged backend
       If the error above is 'Cannot find module <x>', the prune list in step 3
       removed something Prisma Migrate actually needs: drop <x> from that list.
       Re-run with --no-prune to confirm pruning is the cause."; }

  EXPECTED_MIGRATIONS="$(find "$SRC/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)"
  APPLIED_MIGRATIONS="$(
    "$NODE_BIN" -e '
      const Database = require(process.argv[1] + "/backend/node_modules/better-sqlite3");
      const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
      const row = db.prepare("SELECT COUNT(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL").get();
      process.stdout.write(String(row.n));
    ' "$APP_DIR" "$ST/data/pos.db" 2>/dev/null || echo 0
  )"
  [ "$APPLIED_MIGRATIONS" = "$EXPECTED_MIGRATIONS" ] \
    || die "expected $EXPECTED_MIGRATIONS migrations to be applied, found $APPLIED_MIGRATIONS"

  # Re-running must be a clean no-op: postinst and ExecStartPre both call it on
  # every install and every boot.
  ( cd "$APP_DIR/backend" && "$APP_DIR/bin/nodedr-pos-migrate" ) >/dev/null 2>&1 \
    || die "re-running migrations is not idempotent — the service would fail to start on the second boot"
  ok "$APPLIED_MIGRATIONS migrations applied, re-run is a no-op"

  # --- 6b. Every backend source module resolves ----------------------------
  # A prune that removed something used only by, say, PDF receipt generation
  # would not show up in a health check. Requiring every source file forces
  # resolution of every top-level import in the application.
  info "loading every backend source module"
  ( cd "$APP_DIR/backend" && "$NODE_BIN" -e '
      const fs = require("fs"), path = require("path");
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        return e.isDirectory() ? walk(p) : (p.endsWith(".js") ? [p] : []);
      });
      const entrypoint = path.resolve("src/server.js");
      // server.js is excluded on purpose: requiring it calls app.listen(), which
      // binds the API port and keeps the event loop alive forever, so this check
      // would hang and then collide with the real boot test below. It is covered
      // there instead, by actually starting it.
      const files = walk(path.resolve("src")).filter((f) => f !== entrypoint);
      let failed = 0;
      for (const f of files) {
        try { require(f); }
        catch (e) { console.error("  cannot load " + path.relative(process.cwd(), f) + ": " + e.message); failed++; }
      }
      console.log("  " + files.length + " modules loaded (server.js covered by the boot test)");
      // Some modules (the Prisma client, the USB backend) hold the event loop
      // open; nothing here needs to keep running once everything has resolved.
      process.exit(failed ? 1 : 0);
    ' ) || die "some backend modules do not load from the packaged tree"
  ok "all backend modules load"

  # --- 6c. Boot the API and the web server, then go through the proxy ------
  # The frontend can only be tested against BACKEND_PORT, because that address
  # is baked into its routes manifest.
  if "$NODE_BIN" -e '
        const net = require("net");
        const s = net.connect(Number(process.argv[1]), "127.0.0.1");
        s.on("connect", () => { s.destroy(); process.exit(0); });
        s.on("error", () => process.exit(1));
        setTimeout(() => process.exit(1), 800);
      ' "$BACKEND_PORT" 2>/dev/null; then
    warn "port $BACKEND_PORT is already in use on this host — skipping the live proxy test"
  else
    http_probe() {  # http_probe <url> <seconds> ; prints "<status> <body-prefix>"
      "$NODE_BIN" -e '
        const http = require("http");
        const [url, secs] = [process.argv[1], Number(process.argv[2])];
        const deadline = Date.now() + secs * 1000;
        const attempt = () => {
          const req = http.get(url, (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () => {
              process.stdout.write(res.statusCode + " " + body.slice(0, 120).replace(/\s+/g, " "));
              process.exit(0);
            });
          });
          req.on("error", () => {
            if (Date.now() > deadline) { process.stdout.write("000 no-response"); process.exit(1); }
            setTimeout(attempt, 300);
          });
          req.setTimeout(3000, () => req.destroy());
        };
        attempt();
      ' "$1" "$2"
    }

    info "starting the packaged API on 127.0.0.1:$BACKEND_PORT"
    ( cd "$APP_DIR/backend" && BACKEND_PORT="$BACKEND_PORT" \
        "$APP_DIR/bin/nodedr-pos-backend" >"$ST/backend.log" 2>&1 ) &
    ST_BACKEND_PID=$!

    API_HEALTH="$(http_probe "http://127.0.0.1:$BACKEND_PORT/api/health" 25 || true)"
    case "$API_HEALTH" in
      200*ok*) ok "API responded: $API_HEALTH" ;;
      *) sed 's/^/      /' "$ST/backend.log" >&2
         die "the packaged API did not come up (got '$API_HEALTH')" ;;
    esac

    # Any free high port; the web server's own port is runtime-configurable.
    ST_WEB_PORT=21994
    info "starting the packaged web server on 127.0.0.1:$ST_WEB_PORT"
    ( cd "$APP_DIR/frontend" && PORT="$ST_WEB_PORT" HOSTNAME=127.0.0.1 \
        "$NODE_BIN" "$APP_DIR/frontend/server.js" >"$ST/frontend.log" 2>&1 ) &
    ST_FRONTEND_PID=$!

    PAGE="$(http_probe "http://127.0.0.1:$ST_WEB_PORT/" 40 || true)"
    case "$PAGE" in
      200*) ok "web server served the app shell" ;;
      *) sed 's/^/      /' "$ST/frontend.log" >&2
         die "the packaged web server did not serve a page (got '$PAGE')" ;;
    esac

    # THE test: this request goes browser -> web server -> baked-in rewrite ->
    # loopback API. If BACKEND_URL had not been baked in at build time this
    # returns 404/502 instead, which is precisely the failure this package
    # would otherwise ship with.
    PROXIED="$(http_probe "http://127.0.0.1:$ST_WEB_PORT/api/health" 20 || true)"
    case "$PROXIED" in
      200*ok*) ok "/api proxy works end to end: $PROXIED" ;;
      *) sed 's/^/      /' "$ST/frontend.log" >&2
         die "the /api proxy did not reach the API through the web server (got '$PROXIED').
       The routes manifest was verified, so check that the API is listening on
       127.0.0.1:$BACKEND_PORT and that nothing else answers on that port." ;;
    esac

    selftest_cleanup
    ST_FRONTEND_PID=""; ST_BACKEND_PID=""
    wait 2>/dev/null || true
  fi

  # Leave no trace of the test in the payload: the scratch data and cache live
  # under $WORK, and the two symlinks go back to their shipped targets.
  restore_symlinks
  trap cleanup EXIT
  unset DATABASE_URL JWT_SECRET FRONTEND_ORIGIN COOKIE_SECURE

  ok "self-test passed — the packaged application runs"
else
  warn "self-test skipped (--no-selftest)"
fi

# --------------------------------------------------------------------------
# 7. Control metadata and maintainer scripts
# --------------------------------------------------------------------------
step "Generating control metadata"

DEBIAN_DIR="$ROOT/DEBIAN"
mkdir -p "$DEBIAN_DIR"

# Runtime library dependencies:
#   libstdc++6  — better-sqlite3 and usb are C++ addons
#   libudev1    — libusb's device enumeration backend, used by `usb`
#   adduser     — the postinst creates the service account
#   init-system-helpers — deb-systemd-helper / deb-systemd-invoke
# Notably absent: nodejs (bundled — see README.Debian) and sqlite3, whose CLI
# is convenient for admins but is not used by the application (SQLite is
# linked into better-sqlite3). Both would be wrong as hard dependencies, so
# sqlite3 is a Recommends instead.
#
# xdg-utils is only a Suggests (see control.in), deliberately: apt installs
# Recommends by default, and on a headless server xdg-utils pulls in a large
# X11 stack — libegl1, a terminal emulator and friends — for a desktop
# launcher that machine will never use. Measured on a minimal debian:trixie
# container, it added over a hundred packages. Any real desktop already has
# xdg-utils, and /usr/bin/nodedr-pos degrades to `gio open` and then to simply
# printing the URL.
# libatomic1 covers libatomic.so.1, which upstream Node.js started linking
# against as of Node 26 (its official linux-x64 binary did not need it through
# Node 24) — a minimal Debian/Ubuntu server does not have it by default, and
# without it the bundled node binary fails to start with "error while loading
# shared libraries: libatomic.so.1: cannot open shared object file". Verified
# by diffing `ldd` output between the two official tarballs. See the ldd guard
# in step 6 (self-test), which turns any *future* new link-time dependency
# like this into a build failure instead of a runtime crash on a customer's
# machine.
DEPENDS="libc6 (>= 2.28), libstdc++6, libudev1, libatomic1, adduser, init-system-helpers (>= 1.51), systemd"
if [ "$SYSTEM_NODE" -eq 1 ]; then
  DEPENDS="nodejs (>= 20), $DEPENDS"
fi

INSTALLED_SIZE="$(du -sk --exclude=DEBIAN "$ROOT" | cut -f1)"

sed -e "s|@VERSION@|$FULL_VERSION|g" \
    -e "s|@ARCH@|$DEB_ARCH|g" \
    -e "s|@MAINTAINER@|$MAINTAINER|g" \
    -e "s|@INSTALLED_SIZE@|$INSTALLED_SIZE|g" \
    -e "s|@DEPENDS@|$DEPENDS|g" \
    "$PKG_DIR/control.in" > "$DEBIAN_DIR/control"
chmod 0644 "$DEBIAN_DIR/control"

# Marking the config as a conffile is what makes dpkg preserve an operator's
# edits across upgrades (and prompt on a genuine conflict) instead of silently
# overwriting them.
printf '/etc/%s/nodedr-pos.conf\n' "$PKG_NAME" > "$DEBIAN_DIR/conffiles"
chmod 0644 "$DEBIAN_DIR/conffiles"

# Maintainer scripts MUST be 0755 — dpkg refuses to run a non-executable one
# and aborts the installation with "unable to execute".
install -m 0755 "$PKG_DIR/postinst" "$DEBIAN_DIR/postinst"
install -m 0755 "$PKG_DIR/prerm"    "$DEBIAN_DIR/prerm"
install -m 0755 "$PKG_DIR/postrm"   "$DEBIAN_DIR/postrm"

# Syntax-check them here rather than discovering a typo halfway through a
# customer's installation.
for s in postinst prerm postrm; do
  sh -n "$DEBIAN_DIR/$s" || die "syntax error in DEBIAN/$s"
done
bash -n "$ROOT/usr/bin/nodedr-pos"       || die "syntax error in /usr/bin/nodedr-pos"
sh   -n "$APP_DIR/bin/nodedr-pos-backend" || die "syntax error in nodedr-pos-backend"
sh   -n "$APP_DIR/bin/nodedr-pos-migrate" || die "syntax error in nodedr-pos-migrate"

# md5sums lets `dpkg --verify` and debsums detect tampering or disk corruption
# on a deployed till.
( cd "$ROOT" && find . -path ./DEBIAN -prune -o -type f -print0 \
    | sed 's|^\./||' | xargs -0 md5sum 2>/dev/null \
    | sed 's| \./| |' > "$DEBIAN_DIR/md5sums" ) || true
chmod 0644 "$DEBIAN_DIR/md5sums"

ok "control metadata written (installed size ${INSTALLED_SIZE} KB)"

# --------------------------------------------------------------------------
# 8. Normalise permissions and build
# --------------------------------------------------------------------------
step "Building the .deb"

# Everything ships root-owned; directories 0755, files 0644, plus the
# executables re-marked below. npm leaves assorted 0777/0664 modes behind.
find "$ROOT" -path "$ROOT/DEBIAN" -prune -o -type d -exec chmod 0755 {} +
find "$ROOT" -path "$ROOT/DEBIAN" -prune -o -type f -exec chmod 0644 {} +

chmod 0755 "$ROOT/usr/bin/nodedr-pos" \
           "$APP_DIR/bin/nodedr-pos-backend" \
           "$APP_DIR/bin/nodedr-pos-migrate"
[ -f "$APP_DIR/runtime/bin/node" ] && chmod 0755 "$APP_DIR/runtime/bin/node"

# Restore the executable bit on vendored binaries: native .node addons, the
# Prisma schema engine, and anything under a node_modules/.bin.
find "$APP_DIR" -type f \( -name '*.node' -o -name 'schema-engine*' -o -name '*-engine*' \) \
     -exec chmod 0755 {} + 2>/dev/null || true
find "$APP_DIR" -type d -name '.bin' -exec chmod -R 0755 {} + 2>/dev/null || true

mkdir -p "$OUTDIR"

# --root-owner-group avoids needing fakeroot; fall back to fakeroot on older
# dpkg (< 1.19, i.e. pre-buster).
if dpkg-deb --help 2>&1 | grep -q -- '--root-owner-group'; then
  dpkg-deb --root-owner-group -Zxz -z9 --build "$ROOT" "$DEB_FILE" >/dev/null
elif command -v fakeroot >/dev/null 2>&1; then
  fakeroot dpkg-deb -Zxz -z9 --build "$ROOT" "$DEB_FILE" >/dev/null
else
  die "dpkg-deb is too old for --root-owner-group and fakeroot is not installed"
fi

# --------------------------------------------------------------------------
# 9. Verify the artefact
# --------------------------------------------------------------------------
step "Verifying the package"

dpkg-deb --info "$DEB_FILE" >/dev/null   || die "the built package is not readable by dpkg-deb"

# Listed once into a file rather than piped per-check: `grep -q` exits on its
# first match, dpkg-deb takes SIGPIPE, and `set -o pipefail` then reports the
# whole pipeline as failed even though the file was found.
dpkg-deb --contents "$DEB_FILE" > "$WORK/contents.txt"

for required in \
  ./opt/nodedr-pos/backend/src/server.js \
  ./opt/nodedr-pos/backend/prisma.config.js \
  ./opt/nodedr-pos/frontend/server.js \
  ./usr/lib/systemd/system/nodedr-pos.service \
  ./usr/share/applications/nodedr-pos.desktop \
  ./etc/nodedr-pos/nodedr-pos.conf \
  ./usr/bin/nodedr-pos \
  ./opt/nodedr-pos/backend/prisma/migrations \
  ./usr/share/doc/nodedr-pos/copyright \
  ./usr/lib/udev/rules.d/60-nodedr-pos-printer.rules
do
  grep -qF " $required" "$WORK/contents.txt" \
    || die "expected file missing from the package: $required"
done

# Both are symlinks into writable state directories; shipping them as real
# directories instead would silently break persistence under
# ProtectSystem=strict.
for link in \
  "./opt/nodedr-pos/backend/data -> /var/lib/nodedr-pos" \
  "./opt/nodedr-pos/frontend/.next/cache -> /var/cache/nodedr-pos/next"
do
  grep -qF "$link" "$WORK/contents.txt" \
    || die "expected symlink missing or wrong in the package: $link"
done

# Maintainer scripts that are not executable make dpkg abort mid-install with
# "unable to execute". Listed once for the same pipefail reason as above.
dpkg-deb --ctrl-tarfile "$DEB_FILE" > "$WORK/control.tar"
tar -tvf "$WORK/control.tar" > "$WORK/control-listing.txt"
for s in postinst prerm postrm; do
  grep -E "^-rwxr-xr-x .*[/ ]$s\$" "$WORK/control-listing.txt" >/dev/null \
    || die "DEBIAN/$s is not mode 0755 in the built package"
done
ok "payload contents, symlinks and script permissions verified"

if command -v lintian >/dev/null 2>&1; then
  info "running lintian (informational; a bundled-runtime package trips several policy tags by design)"
  lintian --no-tag-display-limit --suppress-tags \
    embedded-library,file-in-unusual-dir,unstripped-binary-or-object,national-encoding \
    "$DEB_FILE" 2>&1 | head -30 || true
fi

SIZE="$(du -h "$DEB_FILE" | cut -f1)"

cat <<EOF

${G}${B}Built $(basename "$DEB_FILE")${N}  ($SIZE, installs ~$((INSTALLED_SIZE / 1024)) MB)
  $DEB_FILE

Install it:
  sudo apt install $DEB_FILE          # resolves dependencies automatically
  # or: sudo dpkg -i $DEB_FILE && sudo apt-get -f install

Then open http://localhost:${FRONTEND_PORT}
EOF
