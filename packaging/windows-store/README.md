# Windows Store edition — build, test and release

`NodeDRPOS.exe` is an Electron shell. It starts two bundled `node.exe` processes (the existing Express/SQLite backend and the Next.js standalone server), waits until both answer, and shows the app in a normal window. No Docker, no service, no admin rights, no browser.

```
NodeDRPOS.exe (Electron) ── window ──▶ gateway 127.0.0.1:1994x  (in the shell process)
                                         ├─ /api, /mcp ─▶ backend   node.exe 127.0.0.1:<random>
                                         └─ everything else ─▶ Next.js  node.exe 127.0.0.1:<random>
```

## Why this design

| Decision | Reason |
|---|---|
| Electron, not WebView2 | WebView2 is not guaranteed on every Windows 10 machine and a fixed-version runtime is a separate large dependency. Electron bundles its own Chromium, so the Start-menu icon works on a clean PC. |
| Bundled `node.exe` for the servers (Electron only draws the window) | `better-sqlite3` and `usb` are built for Node's ABI; the code that runs in Docker runs unchanged. |
| A gateway in the shell instead of Next's `rewrites()` | The rewrite destination is baked in at build time and cannot follow a dynamic port. The gateway also rejects foreign `Host` headers and proves its identity with a per-launch nonce. |
| Own migration runner instead of the Prisma CLI | No schema-engine binary in the package, nothing spawned against the read-only install folder, and a verified backup + rollback around every upgrade. It writes the same `_prisma_migrations` ledger; a test compares its schema with `prisma migrate deploy`. |
| No Windows service | Per-user services are a Store certification risk and need elevation. The app owns its processes and ends them. |
| Loopback only, no LAN mode | No firewall prompt, no exposure. Multi-device use stays a Docker/CasaOS feature. |
| Data in `LocalState` | The documented per-user, non-virtualised app data folder. It survives updates and is removed on uninstall. |

OS prompts/limitations: no UAC and no firewall prompt for normal use. Windows asks for camera permission the first time camera scanning is used. SmartScreen does not apply to Store installs. Uninstall deletes the data folder (documented in-app and in `docs/WINDOWS-STORE.md`).

## Layout of the package

```
NodeDRPOS.exe  + Electron files          (x64)
resources/app/                           main.js, preload.js, splash.html, lib/
resources/nodedr/runtime/node.exe        the Node the native addons were installed with
resources/nodedr/backend/                src, prisma/migrations, production node_modules (no Prisma CLI)
resources/nodedr/frontend/               Next.js standalone server
Assets/  AppxManifest.xml
```

The install folder is never written to. Mutable data is in `%LOCALAPPDATA%\Packages\<PFN>\LocalState\NodeDRPOS`.

## Capabilities

| Capability | Why |
|---|---|
| `runFullTrust` (restricted) | Required for any packaged Win32/Electron app; the app starts its own `node.exe` processes. |
| `webcam` | Camera barcode scanning. |

Not declared: `internetClient`, `packagedServices`, `localSystemServices`, `unvirtualizedResources`, `allowElevation`, `broadFileSystemAccess`, loopback exemptions.

## Build

Windows x64 only (native addons, Electron, `makeappx`).

```powershell
$env:NODEDR_MSIX_IDENTITY_NAME = "<Partner Center > App identity > Package/Identity/Name>"
$env:NODEDR_MSIX_PUBLISHER_CN  = "<... > Publisher>"
pwsh packaging\windows-store\build-msix.ps1 -SelfSignForTesting   # -Version 1.6.3 to override
```

Outputs in `dist\`: `Nodedr-POS-<v>.0-x64.msix` (local install, signed with a throwaway certificate) and `Nodedr-POS-<v>.0-x64.msixupload` (**upload this to Partner Center**; Microsoft re-signs it, no private certificate is involved). The version is `backend/package.json` + `.0`; it must be higher than the version live in Partner Center, and the identity must not change, otherwise Store updates will not target the existing listing.

CI (`.github/workflows/build-windows-store.yml`) uses the `NODEDR_MSIX_IDENTITY_NAME` / `NODEDR_MSIX_PUBLISHER_CN` repository secrets. Without them (forks) it builds under a throwaway identity that must never be uploaded.

## Tests

- `backend`: `node --test test/desktop.*.test.js` — migration runner vs `prisma migrate deploy`, upgrade, failed/interrupted migration recovery, newer/corrupt/locked database, backup/restore/import, process behaviour (loopback only, nonce, clean exit).
- `packaging/windows-store/shell`: `npm test` — gateway, supervisor/watchdog, paths, redaction.
- `ci/e2e.ps1` on a Windows runner against the **installed** package: Start-menu launch, readiness, data location, onboarding + sale, relaunch persistence, clean close, crash cleanup, occupied ports, offline, old-database migration, in-place upgrade, uninstall/reinstall.

Not covered by CI and must be checked on real devices: barcode scanner, receipt printer (system dialog and USB ESC/POS), camera, a clean Windows 10 VM, ARM64.

## Release checklist

1. Bump `backend/package.json` (and the frontend if changed) — version must exceed Partner Center.
2. CI green, download the `nodedr-pos-windows-store` artifact.
3. Run WACK on a clean VM against the `.msix` (the CI run also records a report).
4. Upload the `.msixupload` in Partner Center. Do not publish until the VM checks above pass.
