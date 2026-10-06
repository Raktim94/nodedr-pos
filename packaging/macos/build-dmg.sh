#!/bin/bash
# Builds "NodeDR POS.dmg" — a double-click macOS app for shop owners.
#
# MUST run on macOS (Apple Silicon or Intel): the backend uses native Node
# addons (better-sqlite3), so the payload is assembled by a real `npm ci` on the
# target architecture, same reasoning as the Windows installer.
#
# What ends up in the app:
#   * its own Node.js runtime        — no Docker, no Node install needed
#   * the backend + the Next.js standalone frontend
#   * the tray / menu-bar companion
# Data lives in ~/Library/Application Support/NodeDR POS (survives upgrades).
#
# NOTE ON "DOCKER BUNDLED": Docker Desktop can't be redistributed inside an app
# and isn't needed — the app runs the same code natively, exactly like the
# Windows installer and the .deb. Docker Compose remains available for anyone
# who prefers it.
#
# Usage: packaging/macos/build-dmg.sh [--version 1.2.0] [--arch arm64|x64] [--node 24.18.0]
# Optional signing/notarisation (recommended for distribution):
#   CODESIGN_IDENTITY="Developer ID Application: …"  and, to notarise,
#   NOTARY_PROFILE=<notarytool keychain profile>
set -euo pipefail

VERSION="1.2.0"
NODE_VERSION="24.18.0"
ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"
BACKEND_PORT=4000
FRONTEND_PORT=1994
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --arch)    ARCH="$2"; shift 2 ;;
    --node)    NODE_VERSION="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ "$(uname -s)" = "Darwin" ] || { echo "ERROR: run this on macOS" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/NodeDR POS.app"
RES="$APP/Contents/Resources"
OUT="$ROOT/dist"; mkdir -p "$OUT"

step() { printf '\n==> %s\n' "$*"; }

step "Node.js $NODE_VERSION ($ARCH)"
DIST="node-v${NODE_VERSION}-darwin-${ARCH}"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${DIST}.tar.gz" -o "$WORK/node.tgz"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
EXPECTED="$(awk -v f="${DIST}.tar.gz" '$2 == f { print $1 }' "$WORK/SHASUMS256.txt")"
ACTUAL="$(shasum -a 256 "$WORK/node.tgz" | awk '{print $1}')"
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || { echo "ERROR: Node checksum mismatch" >&2; exit 1; }
mkdir -p "$RES/runtime"
tar -xzf "$WORK/node.tgz" -C "$WORK"
cp "$WORK/$DIST/bin/node" "$RES/runtime/node"
export PATH="$WORK/$DIST/bin:$PATH"

step "Backend"
mkdir -p "$RES/backend"
cp -R "$ROOT/backend/src" "$ROOT/backend/prisma" "$ROOT/backend/package.json" "$ROOT/backend/package-lock.json" "$ROOT/backend/prisma.config.js" "$RES/backend/"
( cd "$RES/backend" && npm ci --omit=dev --no-audit --no-fund && npx prisma generate )

step "Frontend (Next.js standalone)"
( cd "$ROOT/frontend" && npm ci --no-audit --no-fund && BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}" npx next build )
mkdir -p "$RES/frontend"
cp -R "$ROOT/frontend/.next/standalone/." "$RES/frontend/"
mkdir -p "$RES/frontend/.next" && cp -R "$ROOT/frontend/.next/static" "$RES/frontend/.next/static"
[ -d "$ROOT/frontend/public" ] && cp -R "$ROOT/frontend/public" "$RES/frontend/public"

step "Tray companion"
mkdir -p "$RES/tray"
cp "$ROOT/packaging/tray/"{tray.js,lib.js,icon.png,package.json} "$RES/tray/"
( cd "$RES/tray" && npm install --omit=dev --no-audit --no-fund )

step "App bundle"
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>NodeDR POS</string>
  <key>CFBundleDisplayName</key><string>NodeDR POS</string>
  <key>CFBundleIdentifier</key><string>com.nodedr.pos</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleExecutable</key><string>nodedr-pos</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <!-- Menu-bar app: no Dock icon; the tray icon is the way in. -->
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
install -m 0755 "$ROOT/packaging/macos/launcher.sh" "$APP/Contents/MacOS/nodedr-pos"

# Icon: build an .icns from the project logo.
ICONSET="$WORK/AppIcon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512; do
  sips -z $s $s "$ROOT/docs/logo.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ROOT/docs/logo.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"

if [ -n "${CODESIGN_IDENTITY:-}" ]; then
  step "Code signing"
  codesign --force --deep --options runtime --timestamp --sign "$CODESIGN_IDENTITY" "$APP"
fi

step "DMG"
STAGE="$WORK/dmg"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/nodedr-pos-${VERSION}-macos-${ARCH}.dmg"
rm -f "$DMG"
hdiutil create -volname "NodeDR POS" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
if [ -n "${CODESIGN_IDENTITY:-}" ] && [ -n "${NOTARY_PROFILE:-}" ]; then
  step "Notarising"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
fi
echo; echo "Built $DMG"
