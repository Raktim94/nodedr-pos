# Windows installer (`.exe`)

Builds `nodedr-pos-setup-<version>-x64.exe` — a standard Windows installer that
sets NodeDR POS up as two **Windows services**, so the till starts the POS at
boot with nobody logged in. No Docker, no Node.js install, no terminal.

> The Docker Compose deployment and the Debian `.deb` packaging are untouched
> and unaffected by anything in this directory.

---

## Why this is built on a Windows CI runner, not cross-built from Linux

The app depends on two **native** Node addons — `better-sqlite3` and `usb` —
whose compiled binaries are specific to both the platform *and* the Node ABI,
plus Prisma's schema engine, which is a platform-specific executable. Producing
those correctly from a Linux host means hand-fetching Windows prebuilds and
hoping the wiring is right, with no way to run the result.

Building on `windows-latest` instead means `npm ci` fetches the right
`win32-x64` binaries by itself, `prisma generate` emits Windows engines, and —
the part that actually matters — the installer can be **installed, exercised
and uninstalled on real Windows** before anyone downloads it.

See `.github/workflows/build-windows-installer.yml`.

## Windows 11 support

Targets **Windows 11 and Windows 10 (64-bit only)** — there is no OS-version
branching anywhere in the installer or services, by design:

- The installer (`nodedr-pos.nsi`) hard-checks for 64-bit Windows and aborts
  with a clear message on 32-bit, but does not gate on a Windows *version* —
  NSIS, WinSW-wrapped services, `netsh advfirewall`, and junctions all behave
  identically across 10 and 11.
- Both services register as standard Win32 services (`Automatic` start,
  restart-on-failure), which Windows 11's stricter background-app policies
  don't affect — those policies target UWP/Store app suspension, not services.
- Windows 11's default **Domain/Private** network firewall profiles are what
  the installer's allow/block rules target; a machine on the **Public**
  profile (e.g. tethered hotspot) will not expose port 1994 to the LAN by
  design — switch the network to Private for shop/LAN use.
- CI builds on GitHub's `windows-latest` runner (a Windows Server image, the
  closest available automated proxy for modern 64-bit Windows) and every
  build is installed, exercised, and uninstalled there — see the checklist
  below. It has not additionally been hand-tested on consumer Windows 11
  hardware; if you hit a Windows-11-specific issue, please open one.

## What the CI build verifies on real Windows

Every build runs the installer end to end and fails if any of this breaks:

| Check |
| --- |
| Silent install (`/S`) exits 0 |
| Both services registered, running, and set to start at boot |
| `http://localhost:1994/api/health` returns `{"status":"ok"}` |
| App shell renders |
| All 11 Prisma migrations applied |
| `backend\data` is a **junction** into `C:\ProgramData\NodeDRPOS` (not a real folder) |
| Firewall: allow rule on the web port, block rule on the API port |
| Real sale through the `/api` proxy: register → settings → product → checkout |
| **GST inclusive** — 2 × MRP 118 @ 18% totals **236**, not 278.48 |
| Receipt HTML renders and receipt PDF is a real PDF |
| Data survives a full service restart |
| Silent uninstall removes services but **keeps the database** |

---

## Layout once installed

```
C:\Program Files\NodeDRPOS\
  runtime\node.exe            bundled Node.js (nothing else — no npm on a till)
  backend\                    API, Prisma schema + migrations, node_modules
    data\  ──────────────┐    junction
  frontend\              │    Next.js standalone server
    .next\cache\ ────────┤    junction
  service\               │    WinSW service wrappers + XML config
  bin\nodedr-pos.cmd     │    operator CLI
                         ▼
C:\ProgramData\NodeDRPOS\     pos.db, .jwt-secret, logs\, backups\, cache\
```

Neither install nor data directory contains a space — deliberately. Those paths
end up inside a SQLite connection URL, service arguments and batch scripts,
where spaces are a recurring source of quoting bugs.

The two junctions exist because `backend/src/lib/secret.js` writes the JWT
signing secret to a path relative to its own source file, which cannot be
configured by environment. Redirecting the folder keeps the secret and the
database out of Program Files without patching upstream code — the same trick
the Debian package uses with a symlink.

## Services

| Service | Display name |
| --- | --- |
| `NodeDRPOSBackend` | NodeDR POS Backend |
| `NodeDRPOSFrontend` | NodeDR POS Web Interface (depends on the backend) |

Two services rather than one, matching the Linux packaging: only the API touches
the database and the printer, and separate services mean a crashed web server
restarts on its own without dropping the API mid-transaction. Both restart
automatically on failure (5s / 10s / 20s backoff) and log to
`C:\ProgramData\NodeDRPOS\logs`.

## Operator commands

```bat
nodedr-pos open       :: open the POS (starts the services if stopped)
nodedr-pos doctor     :: check services, port and database
nodedr-pos status
nodedr-pos restart    :: needs admin
nodedr-pos backup     :: online, crash-safe copy of the database (admin)
nodedr-pos logs       :: open the log folder
```

Also on the Start Menu. The desktop shortcut runs `nodedr-pos open`, which waits
for the port to accept connections before handing the URL to the browser — so
clicking it right after a cold boot doesn't land on a connection-refused page.

## Network exposure

Windows Firewall denies inbound by default. The installer adds:

- an **allow** rule for TCP **1994** (private/domain profiles) so a counter
  tablet or phone on the shop LAN can open the register;
- an explicit **block** rule for TCP **4000**, the internal API. The browser
  never talks to it — the web server proxies `/api/*` to it over loopback.

This mirrors the Debian package, where the same separation is enforced with
systemd's `IPAddressAllow=localhost`.

## Data, upgrades and removal

- The database lives in `C:\ProgramData\NodeDRPOS`, outside the installed files.
- Installing a newer version over an older one stops the services, replaces the
  program files, and re-runs `prisma migrate deploy` (idempotent).
- **Uninstall keeps the database.** The uninstaller asks separately whether to
  delete shop data, and a silent uninstall (`/S`) never deletes it.

Take a backup before removing anything: `nodedr-pos backup`.

---

## Building

### On GitHub (recommended)

```bash
gh workflow run build-windows-installer.yml \
  -f version=1.0.1 \
  -f release_tag=v1.0.1        # omit to just produce an artifact
```

### Locally, on a Windows machine

Requires Windows x64, Node on `PATH` to bootstrap npm, and NSIS
(`choco install nsis`).

```powershell
pwsh -File packaging\windows\build-windows.ps1 -Version 1.0.1
# -> dist\nodedr-pos-setup-1.0.1-x64.exe

pwsh -File packaging\windows\build-windows.ps1 -SkipInstaller   # payload only
```

The Node runtime is downloaded from nodejs.org and verified against upstream's
`SHASUMS256.txt`; a mismatch aborts the build.

## Code signing

The installer is **not yet** code-signed, so Windows SmartScreen shows
"Windows protected your PC" on first run until the download builds reputation.
Users click *More info → Run anyway*.

Note: as of 2024, EV certificates no longer bypass SmartScreen on first run —
they build reputation the same way OV certificates do, so there is no reason
to pay the EV premium here.

Plan: this project is AGPL-3.0-licensed and public (an OSI-approved
license), so it qualifies for
[SignPath Foundation](https://signpath.io/solutions/open-source-community)'s
free code-signing program for open source projects (an OV-level cert, private
key held on SignPath's HSM — you never handle it). The tradeoff is that the
Authenticode publisher shown to users is "SignPath Foundation", not
"NODEDR INFOTECH PRIVATE LIMITED". If that's ever unacceptable, the
alternative is a paid OV certificate ($150–300/yr, requires an HSM/USB token)
issued directly to the company.

To apply: https://signpath.org/apply. Once approved, SignPath issues an
organization ID, project slug and signing policy slug; add those plus a
`SIGNPATH_API_TOKEN` repository secret, and wire in
[`signpath/github-action-submit-signing-request`](https://github.com/SignPath/github-action-submit-signing-request)
as a step in `build-windows-installer.yml` that signs the NSIS output (and the
bundled WinSW service executables in `packaging/windows/service/`) before the
checksum/upload steps. See the `sign` job scaffold in that workflow — it's
disabled (no-op) until the SignPath IDs are filled in.

Microsoft Store submission (MSI/EXE app type) requires this: the installer
"must be digitally signed with a code signing certificate that chains up to a
[Microsoft Trusted Root Program](https://learn.microsoft.com/en-us/security/trusted-root/participants-list)
CA" — SignPath's cert satisfies that. Elevation (UAC) during install is
explicitly allowed by the Store for this app type; only the installer *UI*
must be silent, which this installer already is (see the "Install silently"
CI step).

**As of this writing, the installer is still unsigned** — do not complete a
Store submission until a signed build exists (SignPath approval + the
`organization-id`/`SIGNPATH_API_TOKEN` above are filled in and a signed
artifact has been produced and verified).

## Microsoft Store "Package details" — exact values to enter

Values for the Store's own Package Details step (Partner Center), derived
from what this installer actually does — not filled in speculatively:

| Field | Value | Why |
| --- | --- | --- |
| **Package URL** | A **versioned** release asset URL, e.g. `https://github.com/Raktim94/nodedr-pos/releases/download/v1.0.0/nodedr-pos-setup-1.0.0-x64.exe` | **Do NOT** use a `/releases/latest/download/...` URL here. That's a moving target — the Store may re-fetch it at review time or on a later re-validation pass and silently pick up whatever the newest release happens to be, including one that hasn't been through the same review/testing as what you intended to submit. Pin the exact version; bump the URL (and re-submit) for each new Store-listed release. |
| **Architecture** | `x64` only | The installer (`nodedr-pos.nsi`) hard-checks for 64-bit Windows and aborts on 32-bit. There is no x86, ARM, ARM64, or neutral build — do not select those. |
| **App type** | `EXE` | NSIS-built `.exe`, not an `.msi`. |
| **Installer parameters** | `/S` | NSIS's standard silent-install switch — this is what `build-windows-installer.yml`'s CI actually exercises on every build ("Install silently" step). Do **not** pick "runs in silent mode without switches" — `/S` is required. |
| **Languages** | English only | The app has no i18n/locale-switching UI (checked: no `next-intl`/`react-i18next`/equivalent anywhere in `frontend/`). Don't claim additional languages. |
| **Installer handling / return codes** | Leave scenario-specific fields blank except **Installation successful → 0** | `nodedr-pos.nsi` has no `SetErrorLevel` calls anywhere and doesn't distinguish "disk full" / "reboot required" / "network failure" / "already installed" / "installation in progress" / "rejected by policy" as separate cases — it only has NSIS's generic success (`0`) vs. `Abort` paths (64-bit check, DB migration failure, service registration failure). Entering specific codes for scenarios this installer doesn't actually detect would misrepresent real failures to the Store/end users. If per-scenario codes are ever needed, they'd have to be added to the `.nsi` script first via explicit `SetErrorLevel` calls before each `Abort`. |

## MSIX (Microsoft Store — no code-signing certificate needed)

`build-msix.ps1` produces `Nodedr-POS-<version>.0-x64.msix`, a second and
entirely independent Store distribution path from the EXE/SignPath route
described above. **Pick one, not both, for an actual Partner Center
submission** — they represent two different Store "app types" for the same
product. MSIX exists because the Store re-signs MSIX packages with a
Microsoft certificate automatically after certification passes, so unlike
the EXE path it needs no CA-trusted cert (SignPath or otherwise) at all.
Building it never touches or depends on `nodedr-pos.nsi` /
`build-windows.ps1`'s EXE output — the EXE keeps shipping from
`pos.nodedr.com/downloads/...` exactly as today.

### What's different from the EXE install

NodeDR POS is two always-on Windows Services with no foreground window (the
"UI" is the shop's browser pointed at `http://localhost:1994`) — WinSW +
NSIS handle that today with a proper installer. MSIX has a real, documented
way to package per-machine Windows Services (the `windows.service` manifest
extension, `LocalSystem` account, gated behind the **`localSystemServices`
restricted capability**), but it's missing two things WinSW's XML config and
the NSIS script provide, which `packaging/windows/msix/` works around at the
packaging layer — **no changes to `backend/src` or `frontend` application
logic**, other than one intentionally small addition (see below):

| Gap | Fix |
|---|---|
| `windows.service` has no attribute for environment variables or a working directory | `msix-wrappers/backend-service.js` / `frontend-service.js` — tiny generated wrappers that set the same env vars WinSW's XML sets today, then `require()` the real, unmodified `backend/src/server.js` / `frontend/server.js` |
| No installer-time hook to run `prisma migrate deploy` | The backend wrapper runs it on every service start instead (idempotent — applies only new migrations, so this covers first-run schema creation *and* future-version upgrades) |
| The `backend\data` / `.next\cache` NTFS junction trick (MSIX's install root is read-only at runtime, unlike Program Files) | `JWT_SECRET` is set directly as an env var by the wrapper — `backend/src/lib/secret.js` already checks `process.env.JWT_SECRET` first, so the file-write path this junction exists for is never reached. `DATABASE_URL` already pointed outside the install tree (`C:\ProgramData\NodeDRPOS\pos.db`) even in the EXE install, so no change needed there. The `.next\cache` junction is simply dropped — it's Next's own build/ISR cache, not user data; most routes here are server-rendered on demand rather than ISR-cached, so this is expected to fail-soft, but it's a genuine open item to confirm via the Application event log in local/CI testing rather than an assumption. |
| `netsh advfirewall` firewall rules (today: installer-time, elevated) | MSIX has no manifest primitive for this. `backend/src/server.js` gained a ~25-line `ensureFirewallRules()` function, opt-in via `MANAGE_FIREWALL=1` (set only by the MSIX wrapper, never in Docker/Debian/dev/the EXE install), which registers the same two rules the installer would have — safe because the service already runs as `LocalSystem`, so no new elevation is needed. **This is the one real application-code change in the whole MSIX conversion.** |
| Missing MSIX visual asset set | Generated fresh every build from `frontend/public/logo.png` (same "generate at build time" approach `build-windows.ps1` already uses for the EXE's `.ico`) — 44/71/150/310×150/StoreLogo sizes |
| No foreground app to launch from the Start Menu tile | `open-pos.cs.template` — a ~15-line C# stub, compiled at build time via `csc.exe` (ships with every Windows install, no extra SDK needed), that does exactly what the EXE's shortcuts do today: wait for the port, open the default browser |

Everything else — login, POS flow, printing, barcode scanning, the database,
the API — is unmodified application code. The direct-USB ESC/POS print path
(`usb`/libusb) is unaffected by this packaging change but was already
Linux-only/unsupported-on-Windows before MSIX entered the picture (see the
main README's printing section); nothing new to do there for Store purposes.

### Package identity — from Partner Center, not invented

Neither `AppxManifest.xml.template` nor `build-msix.ps1` hardcodes a package
identity. Get the real values from **Partner Center → your app → Product
management → App identity**:

- **Package/Identity Name** → `-PackageIdentityName` / `$env:NODEDR_MSIX_IDENTITY_NAME`
- **Publisher ID** (a `CN=...` string) → `-PublisherCn` / `$env:NODEDR_MSIX_PUBLISHER_CN`

`build-msix.ps1` refuses to run if either is missing or still a placeholder.
For CI (`.github/workflows/build-windows-msix.yml`), set both as repository
secrets `NODEDR_MSIX_IDENTITY_NAME` / `NODEDR_MSIX_PUBLISHER_CN`; until
they're set, the workflow still builds and smoke-tests under an obvious
`NodedrPOSCITestOnly` placeholder identity so the pipeline itself stays
exercised — that output is explicitly **not** what gets uploaded to Partner
Center.

`PublisherDisplayName` in the manifest is currently `NODEDR INFOTECH LIMITED`
— note this differs from `NODEDR INFOTECH PRIVATE LIMITED`, used everywhere
else in this repo (NSIS installer, registry, LICENSE). Confirm which is
correct for the Store listing before submitting.

### Building

```powershell
# Requires Windows x64 with Node on PATH (bootstraps npm) — same as build-windows.ps1.
pwsh -File packaging\windows\build-msix.ps1 `
  -Version 1.0.0 `
  -PackageIdentityName "<from Partner Center>" `
  -PublisherCn "<from Partner Center>" `
  -SelfSignForTesting
# -> dist\Nodedr-POS-1.0.0.0-x64.msix
```

`-SelfSignForTesting` signs with a throwaway self-signed cert purely so
`Add-AppxPackage` will install it locally. **Never used for the actual Store
submission** — omit it when building the file you upload to Partner Center;
Microsoft re-signs after certification, which is the entire point of the
MSIX path.

### Local testing

```powershell
# Trust the self-signed test cert once, then enable sideloading:
Import-Certificate -FilePath <path printed by build-msix.ps1> -CertStoreLocation Cert:\LocalMachine\TrustedPeople
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name AllowAllTrustedApps -Value 1

Add-AppxPackage -Path dist\Nodedr-POS-1.0.0.0-x64.msix
Get-Service NodeDRPOSBackend, NodeDRPOSFrontend        # both should be Running
Start-Process http://localhost:1994                    # login, POS flow, print, barcode
Get-WinEvent -LogName Application -MaxEvents 50 | Where-Object LevelDisplayName -eq Error

$pkg = Get-AppxPackage -Name "*NodedrPOS*"
Remove-AppxPackage -Package $pkg.PackageFullName        # uninstall check
```

`.github/workflows/build-windows-msix.yml` runs this exact sequence on
`windows-latest` on every relevant push, plus a best-effort Windows App
Certification Kit (`appcert.exe`) pass if present on the runner image — same
real-Windows-verification discipline as the EXE workflow.

### Partner Center submission

1. Create/select the "Nodedr POS" product in Partner Center (this is also
   where the real package identity above comes from).
2. Packages step → upload `Nodedr-POS-<version>.0-x64.msix` (built **without**
   `-SelfSignForTesting`).
3. Store listing / properties: display name **Nodedr POS**, publisher
   **NODEDR INFOTECH LIMITED** (see the naming-consistency note above),
   x64 only.
4. Submit for certification. No code-signing certificate step exists in this
   flow — Microsoft signs after certification passes.

### Certification risks — not guaranteed

- **`localSystemServices` is a restricted capability.** Microsoft's
  certification team reviews these case by case; declaring it correctly in
  the manifest doesn't guarantee approval.
- **No foreground app on launch is an unusual Store app shape.** This
  product's prior Store submission was rejected on signing (10.2.9) before
  reaching a full functional/content review — that review, and how it treats
  an app whose Start Menu tile opens a browser tab rather than showing UI
  itself, hasn't been tested yet.
- The dropped `.next\cache` junction (see the gap table above) is reasoned
  through, not yet confirmed error-free under MSIX — check the Application
  event log during local/CI testing before submitting.
- **`Add-AppxPackage` registers the two services but does not start them**
  (confirmed on real windows-latest CI, 2026-08-14 — `StartupType="auto"`
  only takes effect at the *next* boot, same as a plain `sc create
  start=auto`). `open-pos.exe` now starts both services itself before
  waiting for the port, mirroring `nodedr-pos.cmd`'s existing start-if-not-
  running check for the EXE install. **Open question, not yet verified**:
  whether a non-elevated interactive process (the Start Menu tile launch)
  actually has permission to start a `LocalSystem` service registered via
  `packagedServices` — if the ACL doesn't grant this, first launch after
  install would need a manual `Start-Service ... ` as Administrator (or a
  reboot) instead of "just works." CI works around this by running
  `Start-Service` from an already-elevated context, which doesn't answer
  the question for a real Store install.
- Every manifest detail above (the `desktop6` extension schema, `MinVersion
  10.0.19041.0`, the wrapper approach) is written from Microsoft's public
  documentation, not verified end-to-end on a physical Windows machine from
  this build environment — `makeappx pack` and the CI install/uninstall
  cycle are the real validation gates; a clean CI run is meaningfully more
  evidence than the manifest merely looking right.

## Notes for certification (suggested text for Store reviewers)

> NodeDR POS installs two Windows Services (NodeDRPOSBackend, NodeDRPOSFrontend)
> and opens local firewall port 1994 for LAN access from a counter tablet/phone
> (private/domain network profiles only). No pre-seeded test account exists —
> the first launch shows a registration screen; create an admin account there
> (Settings → Company, then add a product, then run a sale through the POS
> screen to exercise the full checkout flow). USB thermal printer support is
> optional and not required to test core functionality — printing also works
> via the browser print dialog with no physical printer attached. Elevation
> (UAC) during install is expected and by design (installing Windows Services
> requires it); the installer UI itself runs silently per Store requirements.
