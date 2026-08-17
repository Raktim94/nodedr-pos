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

The EXE install is two always-on Windows Services with no foreground window
(the "UI" is the shop's browser pointed at `http://localhost:1994`) — WinSW +
NSIS handle that today. **The MSIX build is architecturally different on
purpose, not just repackaged**: it is a real foreground app.
`open-pos.exe` (`packaging/windows/msix/launcher/`) is a small WebView2-hosted
window — when the shopkeeper opens it, it spawns the backend and frontend as
its own plain child processes (no Windows Service, no SCM registration), waits
for the frontend's port, and shows the POS UI inside its own app window
instead of opening a browser tab. Closing the window stops both child
processes.

This was a deliberate trade-off, not a default: an earlier draft of this MSIX
package used the `windows.service` manifest extension (WinSW-wrapped, same
model as the EXE install) and needed the **`packagedServices`** and
**`localSystemServices`** restricted capabilities for it — both gone now.
The one thing given up for that: **this build is single-machine and
foreground-only**. Unlike the EXE/Docker installs, other devices on the shop
LAN (a counter tablet, a phone doing camera-scan) cannot reach the POS from
this build while its window is closed — the frontend binds to `127.0.0.1`
only and no firewall rules are opened. If that trade-off ever needs
reversing, the Windows-Service model is still exactly what the EXE install
uses; see git history for the pre-2026-08-14 version of this package for the
`windows.service`/WinSW approach.

`packaging/windows/msix/` handles this at the packaging layer —
**no changes to `backend/src` or `frontend` application logic** beyond what
was already there for the EXE install (`ensureFirewallRules()` simply stays
a no-op here since `MANAGE_FIREWALL` is never set for this path):

| Problem | Fix |
|---|---|
| MSIX's install root is read-only at runtime, unlike Program Files (no NTFS junction trick available) | `msix-wrappers/backend-service.js` (spawned directly by `open-pos.exe`, see below) generates/reads a real random `JWT_SECRET` at `C:\ProgramData\NodeDRPOS\.jwt-secret` (same technique `backend/src/lib/secret.js` itself uses) and passes it in as an env var — `secret.js` already checks `process.env.JWT_SECRET` first. `DATABASE_URL` already pointed outside the install tree (`C:\ProgramData\NodeDRPOS\pos.db`) even in the EXE install, so no change needed there. |
| No installer-time hook to run `prisma migrate deploy` | The backend wrapper runs it every time `open-pos.exe` starts the backend process instead (idempotent — applies only new migrations, so this covers first-run schema creation *and* future-version upgrades) |
| No Start Menu tile behavior at all until built | `open-pos.exe` (`packaging/windows/msix/launcher/`, `dotnet publish`-built .NET Framework 4.8 WinForms + WebView2 app) — spawns both child processes via `System.Diagnostics.Process`, assigns them to a Win32 Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (so they're force-terminated if this app crashes, not just on a clean close — the same technique Electron uses on Windows), waits for the frontend port, then shows a `WebView2` control navigated at `http://localhost:1994`. A named Mutex guards against a second launch spawning a conflicting second pair of processes. |
| WebView2's default user-data folder is next to the exe — the read-only package root | `Program.cs` passes an explicit `userDataFolder` under `C:\ProgramData\NodeDRPOS\webview2-data` to `CoreWebView2Environment.CreateAsync`. |
| Missing MSIX visual asset set | Generated fresh every build from `frontend/public/logo.png` (same "generate at build time" approach `build-windows.ps1` already uses for the EXE's `.ico`) — 44/71/150/310×150/StoreLogo sizes |

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

**Status: both secrets are set** (from Partner Center → Nodedr POS → Product
management → App identity, 2026-08-14). `gh secret list --repo
Raktim94/nodedr-pos` shows both present; the values themselves aren't
repeated here since the point of this section is "get them from Partner
Center," not "trust a copy pasted into a README." A `workflow_dispatch` run
(`31820010280`) confirmed `Resolve package identity` picks up
`has-real-identity=true` and the resulting package installs, launches, and
passes every CI check under the real identity — see "Partner Center
submission" below for what's left before an actual upload.

`PublisherDisplayName` in the manifest is `NODEDR INFOTECH LIMITED`,
matching the legal name used everywhere else in this repo (NSIS installer,
LICENSE, README, MAINTAINERS.md) — this must also match the legal business
name registered on the Partner Center account, since Store certification
checks publisher identity consistency.

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

# Launch from the Start Menu ("Nodedr POS") or:
Start-Process shell:AppsFolder\$(Get-AppxPackage -Name "*NodedrPOS*").PackageFamilyName!NodeDRPOS
# A window should open showing the POS UI directly (no browser tab) — try
# login, POS flow, print, barcode. Closing the window should also end the
# two node.exe child processes (check Task Manager).
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
   where the real package identity above comes from — already configured as
   repo secrets, see above).
2. Build the actual upload **without** `-SelfSignForTesting` — either:
   ```powershell
   pwsh -File packaging\windows\build-msix.ps1 -Version 1.0.0 `
     -PackageIdentityName "<from Partner Center>" -PublisherCn "<from Partner Center>"
   ```
   or `gh workflow run build-windows-msix.yml -f version=1.0.0 -f
   release_tag=<an existing release tag>` (this both builds under the real
   identity from the repo secrets **and**, since a `release_tag` is given,
   attaches the resulting `.msix` to that GitHub release — still not the
   Partner Center upload itself, just where to grab the built file from).
   Every CI-triggered build still uses `-SelfSignForTesting` for its own
   local install/smoke-test — that flag only needs to be absent from the
   file actually uploaded to Partner Center.
3. Packages step → upload `Nodedr-POS-<version>.0-x64.msix`.
4. Privacy policy URL: `https://pos.nodedr.com/privacy` — already covers the
   app's own data handling (local-only storage, camera/printer/local-network
   use, no telemetry), not just the marketing site.
5. Store listing / properties: display name **Nodedr POS**, publisher
   **NODEDR INFOTECH PRIVATE LIMITED**, x64 only.
6. Submit for certification, with the certification-notes text below. No
   code-signing certificate step exists in this flow — Microsoft signs after
   certification passes.

### Certification risks — not guaranteed

- **`runFullTrust` is still a restricted capability.** Microsoft's
  certification team reviews it case by case; declaring it correctly in the
  manifest doesn't guarantee approval — but it's the single most common
  restricted capability in the Store (every classic Win32 app packaged as
  MSIX needs it), so friction here is expected to be materially lower than
  the previous `packagedServices`/`localSystemServices` declarations were.
- **WebView2 Runtime — happy path confirmed, missing-runtime fallback is
  not.** Real Windows CI (`windows-latest`, multiple green runs as of
  2026-08-14, including one under the real Partner Center identity) confirms
  the actual launch sequence works end-to-end: `open-pos.exe` starts,
  spawns both child processes, `CoreWebView2Environment.CreateAsync`
  succeeds, the app answers its health check, and closing it cleanly kills
  both children (verified via the CI job's explicit process-tree checks).
  What's still unconfirmed is the *other* branch — `Program.cs`'s fallback
  message for `WebView2RuntimeNotFoundException` — since every CI runner
  image already has the Evergreen runtime (bundled with Edge). That's
  expected to be rare on real end-user hardware too (Windows 11 and current
  Windows 10 ship it by default) but hasn't been exercised on a machine
  that's actually missing it.
- **This is a foreground-only, single-machine app now — a real functional
  change from the earlier always-on-services draft**, not just a packaging
  detail. If Partner Center's functional review expects the "install once,
  runs in the background" shape the product's own README describes for the
  EXE/Docker installs, this MSIX build's foreground-only scope should be
  called out explicitly in the certification notes (see below) rather than
  assumed obvious.
- What real Windows CI has actually exercised, end-to-end, under both the
  CI-test identity and the real Partner Center identity: `dotnet publish`
  of the launcher, `makeappx pack`, install, launch, backend+frontend child
  processes starting, database creation (via the `prisma migrate deploy`
  fix — see git history for the EPERM bug this caught and fixed), the
  health check, loopback-only port binding, clean shutdown killing both
  children, and uninstall preserving the database. Not yet exercised
  anywhere in this pipeline: the real Windows App Certification Kit pass
  (the CI step is best-effort — only runs if `appcert.exe` happens to be
  present on the runner image) and an actual Partner Center certification
  pass, which is the real remaining validation gate.

## Notes for certification (suggested text for Store reviewers)

> NodeDR POS is a single-machine, offline-first Point of Sale app. Opening it
> starts its own local backend and web server as child processes (bound to
> 127.0.0.1 only — no network services, no LAN exposure in this Store build)
> and displays the POS UI in this app's own window via WebView2; closing the
> window stops those processes. No pre-seeded test account exists — the
> first launch shows a registration screen; create an admin account there
> (Settings → Company, then add a product, then run a sale through the POS
> screen to exercise the full checkout flow). USB thermal printer support is
> optional and not required to test core functionality — printing also works
> via the built-in print dialog with no physical printer attached. This
> package declares `runFullTrust` because it launches local Node.js
> processes as part of its normal operation (the backend API and web
> server) — it installs and runs no system service and requests no other
> restricted capability.
