# Native packaging for NodeDR POS

Two installers live here, both additive to the Docker deployment:

| Target | Directory | Output |
| --- | --- | --- |
| Debian / Ubuntu | `packaging/debian/` + `build-deb.sh` | `nodedr-pos_<version>_amd64.deb` |
| Windows 10/11 x64 | `packaging/windows/` | `nodedr-pos-setup-<version>-x64.exe` |

The Windows installer is built and smoke-tested on a Windows CI runner — see
[`windows/README.md`](windows/README.md) for why and how.

---

# Debian package (`.deb`)

This directory builds NodeDR POS into a standalone `.deb` for Debian and
Ubuntu. The installed package runs as a **systemd service**, needs **no
Docker**, and needs **no terminal** after installation — the user
double-clicks the `.deb`, then launches *NodeDR POS* from the applications
menu.

> The Docker Compose deployment (`docker-compose.yml`, `install.sh`, both
> `Dockerfile`s) is untouched and keeps working exactly as before. Nothing in
> this directory is referenced by the Docker build, and the build script never
> writes into your working tree.

---

## 1. What gets installed

| Path | Contents |
| --- | --- |
| `/opt/nodedr-pos/runtime/` | Bundled Node.js runtime (`bin/node` only) |
| `/opt/nodedr-pos/backend/` | Express API, Prisma schema + migrations, `node_modules` |
| `/opt/nodedr-pos/frontend/` | Next.js standalone production server |
| `/opt/nodedr-pos/bin/` | `nodedr-pos-backend`, `nodedr-pos-migrate` |
| `/usr/bin/nodedr-pos` | Operator CLI (`status`, `logs`, `doctor`, `backup`, …) |
| `/usr/lib/systemd/system/` | `nodedr-pos.service` + backend/frontend units |
| `/usr/lib/udev/rules.d/` | `60-nodedr-pos-printer.rules` (USB thermal printer) |
| `/usr/share/applications/` | `nodedr-pos.desktop` launcher |
| `/etc/nodedr-pos/` | `nodedr-pos.conf` — dpkg **conffile**, survives upgrades |
| `/var/lib/nodedr-pos/` | SQLite database, JWT secret, backups — **survives removal** |
| `/var/cache/nodedr-pos/` | Next.js runtime cache — disposable |

Runtime layout at a glance:

```
        browser / tablet / phone
                  │  http://<till-ip>:1994
                  ▼
   nodedr-pos-frontend.service      (Next.js, binds 0.0.0.0:1994)
                  │  /api/* proxied server-side
                  ▼  http://127.0.0.1:4000   (loopback only, IPAddressAllow=localhost)
   nodedr-pos-backend.service       (Express + Prisma, group `lp` for the printer)
                  │
                  ▼
   /var/lib/nodedr-pos/pos.db       (SQLite)
```

### Why two units under one `nodedr-pos.service`

`nodedr-pos.service` is the only unit an operator touches —
`systemctl start|stop|restart|status nodedr-pos` — and it is the only one
enabled at boot. It supervises two real units, because the API and the web
server have different privilege needs (only the API touches the USB printer)
and different failure modes. Each child declares `PartOf=nodedr-pos.service`,
so stop/restart propagate. Running both processes from a single unit would
mean losing per-process restart, per-process sandboxing, and accurate exit
codes — a web-server crash would take the API down mid-transaction.

### Why Node.js is bundled instead of `Depends: nodejs`

The app uses two native addons (`better-sqlite3`, `usb`) compiled against a
specific Node ABI, and it targets Node 24 — Debian 12 ships Node 18 and Ubuntu
24.04 ships Node 18.19. A `Depends: nodejs` would install a Node whose
`NODE_MODULE_VERSION` does not match the compiled addons, and the service
would fail at *runtime* with a confusing ABI error. Bundling also means the
package cannot break, or be broken by, whatever Node the user has for their
own projects.

If you must use the distribution's Node instead, build with `--system-node`;
the package then declares `Depends: nodejs (>= 20)` and installs a shim that
delegates to `/usr/bin/node`. Verify the ABI matches before shipping it.

`sqlite3` is a **Recommends**, not a Depends: SQLite is linked into
`better-sqlite3`, so the CLI is only there for admins who want to poke at the
database by hand.

---

## 2. Building

### Build host requirements

```bash
sudo apt-get update
sudo apt-get install -y dpkg-dev git curl xz-utils ffmpeg
# Only needed if npm cannot find prebuilt binaries for your distro/arch:
sudo apt-get install -y build-essential python3 pkg-config libudev-dev
```

The build host **must be the same architecture as the target** — native
modules are compiled/downloaded for the build ABI, so there is no
cross-compilation path. For `arm64` builds, run the script on an arm64 machine
or in an emulated `arm64` container.

### Build

```bash
./packaging/build-deb.sh
# → dist/nodedr-pos_1.0.0_amd64.deb
```

Useful options:

```bash
./packaging/build-deb.sh --version 1.0.1 --revision 1     # 1.0.1-1
./packaging/build-deb.sh --source https://github.com/Raktim94/nodedr-pos.git --ref v1.0.0
./packaging/build-deb.sh --arch arm64                     # on an arm64 host
./packaging/build-deb.sh --port 8080                      # different web port
./packaging/build-deb.sh --from-worktree                  # include uncommitted changes
./packaging/build-deb.sh --system-node                    # no bundled runtime
./packaging/build-deb.sh --help
```

By default the script clones a **clean checkout** of the current repo into a
temp directory; your working tree, `node_modules/` and `.next/` are never
touched. The Node tarball is cached in `~/.cache/nodedr-pos-deb/` and verified
against upstream's `SHASUMS256.txt` — a mismatch deletes the cached copy and
aborts.

### What the build verifies before emitting a package

The script fails loudly rather than shipping a broken artefact if:

1. `better-sqlite3`, `usb`, `@prisma/client` or the adapter fail to `require()`
   under the bundled Node binary (catches ABI/prebuild problems at build time
   rather than on the customer's till).
2. The `/api` proxy destination did **not** get baked into
   `.next/routes-manifest.json`. Next.js resolves rewrite destinations at
   *build* time; a runtime `BACKEND_URL` is silently ignored, which would make
   every API call 502.
3. `prisma.config.js` is missing from the payload — Prisma 7 keeps the
   Migrate connection URL there, and without it the service crash-loops on
   `migrate deploy`.
4. Any maintainer script has a shell syntax error (`sh -n` / `bash -n`).
5. Any expected file is absent from the final archive.

### File permissions

The build script sets these; they are listed here because getting them wrong
is the classic way to produce a `.deb` that fails at install time.

| Path | Mode | Why |
| --- | --- | --- |
| `DEBIAN/postinst`, `DEBIAN/prerm`, `DEBIAN/postrm` | **0755** | dpkg refuses to run a non-executable maintainer script and aborts the install |
| `DEBIAN/control`, `DEBIAN/conffiles`, `DEBIAN/md5sums` | 0644 | metadata |
| `/opt/nodedr-pos/runtime/bin/node` | 0755 | the interpreter |
| `/opt/nodedr-pos/bin/*`, `/usr/bin/nodedr-pos` | 0755 | executables |
| `*.node`, Prisma engine binaries, `node_modules/.bin/*` | 0755 | npm leaves inconsistent modes; addons must stay executable |
| systemd units, udev rules, `.desktop`, `.conf` | 0644 | systemd warns on world-writable units |
| everything else | 0644 files / 0755 dirs, `root:root` | via `dpkg-deb --root-owner-group` |
| `/var/lib/nodedr-pos` | 0750 `nodedr-pos:nodedr-pos` | holds customer data and sales history — not world-readable |
| `/var/lib/nodedr-pos/pos.db` | 0640 | ditto |
| `/var/lib/nodedr-pos/.jwt-secret` | 0600 | session signing key |

---

## 3. Installing and testing on Ubuntu/Debian

### Install

```bash
sudo apt install ./dist/nodedr-pos_1.0.0_amd64.deb
# or
sudo dpkg -i dist/nodedr-pos_1.0.0_amd64.deb && sudo apt-get -f install
```

Desktop users can also just double-click the file (GNOME Software / Discover /
GDebi). `postinst` creates the service account, initialises the database, runs
the migrations, enables the service, starts it, waits up to 60s for the port,
and prints the URL.

### Smoke test

```bash
nodedr-pos doctor          # units, ports, database, printer wiring
systemctl status nodedr-pos
curl -fsS http://localhost:1994/api/health     # {"status":"ok"}
curl -fsSI http://localhost:1994/ | head -1    # HTTP/1.1 200 OK
```

Then open <http://localhost:1994>, create the admin account, complete shop
setup, add a product, and run a sale end to end.

Confirm the API is **not** reachable from the LAN (it should refuse; only
:1994 is public):

```bash
curl -m 3 http://<till-ip>:4000/api/health     # must fail to connect
ss -ltnp | grep -E '1994|4000'                 # 4000 bound to 127.0.0.1 only
```

### The tests that actually catch this project's known failure modes

**Data must survive a service restart and a package upgrade.** This is the
regression that a fresh-install test cannot catch, because a fresh install
starts from an empty database and never proves anything was read back across a
process boundary:

```bash
# 1. create real data through the UI (a product, a sale), then:
sudo systemctl restart nodedr-pos
# 2. reload the page — the sale must still be there.

# 3. now the upgrade path:
sudo apt install ./dist/nodedr-pos_1.0.1_amd64.deb
nodedr-pos doctor          # data still present, migrations applied
```

**`apt remove` must not delete the shop's data:**

```bash
sudo apt remove nodedr-pos
ls -l /var/lib/nodedr-pos/pos.db      # still there
sudo apt install ./dist/nodedr-pos_1.0.0_amd64.deb
# reinstall and confirm the old sales history is back
```

**`apt purge` must delete it** (this is the destructive path — back up first):

```bash
sudo nodedr-pos backup /root/pos-before-purge.db
sudo apt purge nodedr-pos
ls /var/lib/nodedr-pos                # gone
id nodedr-pos                         # no such user
```

**Boot persistence:**

```bash
sudo reboot
# after login:
nodedr-pos doctor                     # everything active with no manual step
```

**Thermal printer** (only meaningful with a printer attached):

```bash
ls -l /dev/usb/lp0                    # crw-rw---- root lp
id -nG nodedr-pos | tr ' ' '\n' | grep -x lp
# then in the app: Settings → Receipt → USB printer check → Print test slip
```

### Testing in a container (no spare hardware)

`systemd` needs to be PID 1, so use a systemd-enabled container:

```bash
docker run -d --name deb-test --privileged \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --cgroupns=host \
  -p 1994:1994 debian:trixie /sbin/init

docker cp dist/nodedr-pos_1.0.0_amd64.deb deb-test:/tmp/
docker exec deb-test bash -c 'apt-get update && apt-get install -y /tmp/nodedr-pos_1.0.0_amd64.deb'
docker exec deb-test nodedr-pos doctor
curl -fsS http://localhost:1994/api/health
```

USB printing cannot be tested this way — the container has no printer.

---

## 4. Configuration

Edit `/etc/nodedr-pos/nodedr-pos.conf`, then `sudo systemctl restart nodedr-pos`.
It is a dpkg conffile, so edits survive upgrades.

| Key | Default | Notes |
| --- | --- | --- |
| `PORT` | `1994` | Web interface port; the launcher and CLI read it |
| `HOSTNAME` | `0.0.0.0` | Set `127.0.0.1` to restrict to the till itself |
| `BACKEND_PORT` | `4000` | **Cannot be changed after build** — see below |
| `FRONTEND_ORIGIN` | `http://localhost:1994` | API CORS origin |
| `COOKIE_SECURE` | `false` | `true` only when served over HTTPS |
| `DATABASE_URL` | `file:/var/lib/nodedr-pos/pos.db` | Must be an **absolute** `file:` URL |
| `JWT_SECRET` | *(unset)* | Auto-generated to `/var/lib/nodedr-pos/.jwt-secret` on first boot |

`BACKEND_PORT` is baked into the Next.js routes manifest at build time. To move
it, rebuild: `./packaging/build-deb.sh --backend-port 4100`.

`DATABASE_URL` must stay absolute. The `better-sqlite3` driver adapter resolves
relative paths against the process working directory (not against
`schema.prisma`), so a relative path silently creates the database somewhere
else and looks like data loss on restart.

---

## 5. Enterprise / fleet deployment

The package is built for unattended server and multi-till deployment.

**Unattended install** — `postinst` never prompts:

```bash
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ./nodedr-pos_1.0.0_amd64.deb
```

**Headless servers** — nothing requires a desktop session. The `.desktop`
launcher is inert without one; `systemd` starts the service at boot regardless.

**Serving over the network / behind TLS.** Put nginx or Caddy in front, set
`COOKIE_SECURE=true`, and set `HOSTNAME=127.0.0.1` so only the reverse proxy
can reach the app:

```nginx
server {
  listen 443 ssl;
  server_name pos.example.com;
  location / {
    proxy_pass http://127.0.0.1:1994;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

The API already sets `trust proxy 1`, so rate limiting and IP logging see the
real client address through one hop.

**Hardening already applied** in the shipped units (`systemd-analyze security
nodedr-pos-backend.service` to review): dedicated unprivileged system account,
empty `CapabilityBoundingSet`, `NoNewPrivileges`, `ProtectSystem=strict` with
an explicit `ReadWritePaths`, `ProtectHome`, `PrivateTmp`, `ProtectProc`,
`RestrictNamespaces`, `RestrictSUIDSGID`, `SystemCallFilter=@system-service`,
and `DevicePolicy=closed` granting only USB device majors 180 and 189 for the
printer. The API additionally runs under `IPAddressDeny=any` +
`IPAddressAllow=localhost`, so it can neither be reached from the LAN nor dial
out — the kernel-level equivalent of the `expose:`-not-`ports:` choice in
`docker-compose.yml`.

`MemoryDenyWriteExecute` is deliberately **off**: V8 JIT-compiles into
writable-then-executable pages and Node aborts at startup with it enabled.

**Repository distribution** — for a fleet, serve the `.deb` from an apt repo
(`reprepro` or `aptly`) so tills upgrade with `apt upgrade` and package
signature verification, instead of copying files around.

**Monitoring** — the service logs to the journal under
`nodedr-pos-backend`/`nodedr-pos-frontend`. `GET /api/health` is a cheap
liveness probe. `nodedr-pos doctor` exits non-zero when anything is down, so it
works directly as a Nagios/Icinga check.

**Backups** — `nodedr-pos backup` uses SQLite `VACUUM INTO`, which is safe
while the shop is trading (`cp` of a live SQLite file is not). Nightly:

```
0 23 * * * root /usr/bin/nodedr-pos backup /var/backups/nodedr-pos/pos-$(date +\%F).db
```

**RPM hosts (RHEL/Rocky/Alma).** `.deb` is Debian-family only. The same payload
converts with `fpm`, since the layout is already FHS-correct and
distro-agnostic:

```bash
sudo apt-get install -y ruby ruby-dev && sudo gem install fpm
./packaging/build-deb.sh --keep      # note the printed build directory
fpm -s dir -t rpm -n nodedr-pos -v 1.0.0 -C <build-dir>/root \
    --after-install packaging/debian/postinst \
    --before-remove packaging/debian/prerm \
    --after-remove  packaging/debian/postrm \
    --depends systemd .
```

The maintainer scripts use `adduser`/`deluser` and `deb-systemd-helper`, all of
which are guarded with `command -v` fallbacks to plain `useradd`/`systemctl`,
so they run on RPM hosts too.
