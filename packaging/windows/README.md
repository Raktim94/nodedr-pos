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

The installer is **not** code-signed, so Windows SmartScreen will show
"Windows protected your PC" on first run until the download builds reputation.
Users click *More info → Run anyway*.

Signing needs an OV/EV code-signing certificate (a paid, identity-verified
purchase that cannot be automated here). Once you have one, add the PFX and
password as repository secrets and sign both the payload and the installer with
`signtool` before the upload step in the workflow.
