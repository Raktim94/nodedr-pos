# Native packaging

Only the **macOS app** (`macos/`, built by `.github/workflows/build-macos-dmg.yml`)
and the tray helper it bundles (`tray/`) live here. The Windows `.exe` and
Debian `.deb` installers were retired: on Windows and Linux, run NodeDR POS
with Docker Compose or CasaOS, which can update themselves from
**Settings → Updates**.
