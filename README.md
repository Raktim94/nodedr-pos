# nodedr-pos

A free, open-source, **fully offline** Point of Sale and inventory management
system for small retail shops. It runs entirely on a local machine via
Docker — no internet connection, no subscription, no cloud dependency, and
no data ever leaves the shop.

Built for a barcode-scanner-and-thermal-printer counter setup: scan an item
to sell it, press Enter to check out, and a receipt prints automatically.

Access it at **`http://<machine>:1994`** — from the shop's own machine or any
tablet/phone on the same network.

## Features

- **Guided onboarding** — first launch walks you through creating an admin
  account and configuring your company (name, address, currency, GST,
  loyalty) before you ever see the dashboard.
- **Barcode-driven POS checkout** — scan to add to the cart, scan again to
  bump quantity, press **Enter** to finalize. Unknown barcodes surface a
  toast instead of blocking the register.
- **GST / tax** — per-product GST rates with HSN/SAC codes; bills show a
  CGST/SGST breakdown and your GSTIN. Toggle on/off in settings.
- **Discounts** — percentage or flat-amount discount per sale, applied
  correctly across mixed tax rates.
- **Loyalty program** — customers (by phone) earn points on every purchase,
  redeemable as a discount at checkout. Configurable earn rate and point
  value.
- **Multi-currency** — ₹ INR, $ USD, € EUR, or £ GBP, switchable in settings;
  the symbol flows through the whole app and onto receipts.
- **Customers** — a directory with visit counts, total spend, and loyalty
  balances.
- **Customizable receipts** — set a header and footer; the thermal receipt
  renders your branding, GST breakdown, discounts, and loyalty summary.
- **Multiple payment methods** — Cash (with change calculation), UPI, Card.
- **Staff accounts & roles** — an admin plus any number of cashier logins;
  admins manage staff and settings, cashiers run the register.
- **Sales history** — searchable past invoices with a detail view and
  one-click receipt reprint.
- **Inventory management** — scan a known barcode to edit stock; an unknown
  one opens "Add Product" pre-filled. Low-stock dashboard alerts.
- **Thermal receipt printing** — auto-formats and prints a 58/80mm ESC/POS
  receipt (see [layout](#receipt-layout)) and cuts the paper.
- **Zero external calls at runtime** — once built, the app never talks to
  anything outside your machine.

## Architecture

```
  Browser / LAN tablet
        │  http://<machine>:1994   (the ONLY exposed port)
        ▼
┌──────────────────────┐   /api/* proxied server-side   ┌──────────────────────┐
│   frontend  :1994    │ ──────────────────────────────▶ │  backend (internal)  │
│   Next.js / React     │ ◀────────────────────────────── │  Express + Prisma    │
└──────────────────────┘   (internal Docker network)      └──────────┬───────────┘
                                                                      │
                                                        ┌─────────────┼────────────┐
                                                        ▼                          ▼
                                              SQLite (nodedr-pos_data)     USB thermal printer
                                              (named Docker volume)        (device passthrough)
```

**One port, one origin.** The browser only ever talks to the frontend on
port **1994**. The Next.js server proxies every `/api/*` request to the
backend over the internal Docker network — the backend is **not** published
to the host at all. This means:

- the app works from **any device on the LAN** (a counter tablet, a phone),
  not just the machine running the containers;
- session cookies are first-party, so there's no cross-origin/CORS fragility;
- the API isn't exposed on the network, shrinking the attack surface.

The backend and frontend are two separate containers: only the backend needs
raw USB access to the printer, so only it runs `privileged: true` with a
device mapping. Everything still comes up with a single `docker compose up`.

## Tech stack

| Layer      | Choice                                                  |
| ---------- | -------------------------------------------------------- |
| Frontend   | Next.js (App Router), React, TypeScript, Tailwind CSS     |
| Data layer | TanStack Query, react-hook-form + Zod                    |
| Backend    | Node.js, Express, Zod validation, helmet, rate limiting   |
| Database   | SQLite via Prisma ORM, persisted in a Docker volume        |
| Auth       | bcrypt hashing, HttpOnly JWT cookie, admin/cashier roles   |
| API access | Browser → Next.js (:1994) → server-side `/api` proxy → backend |
| Hardware   | `escpos-usb` (raw USB) for the printer; a custom React hook for the barcode scanner |
| Deployment | Docker Compose, two `node:20-alpine` multi-stage images    |

## Quick start

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose
(bundled with current Docker Desktop/Engine).

### One-click install

```bash
git clone https://github.com/Raktim94/nodedr-pos.git && cd nodedr-pos && ./install.sh
```

[`install.sh`](install.sh) checks that Docker is installed, builds both
images, starts the stack, waits for the backend to report healthy, then
prints the URL to open. Re-run it any time to rebuild after pulling updates.

### Manual install

If you'd rather run each step yourself (or `install.sh` doesn't fit your
setup), here's exactly what it does, one command at a time:

```bash
# 1. Get the code
git clone https://github.com/Raktim94/nodedr-pos.git
cd nodedr-pos

# 2. Build the backend and frontend images (multi-stage, node:20-alpine).
#    First run takes a few minutes; later runs are cached and fast.
docker compose build

# 3. Start both containers in the background. Compose automatically
#    creates the named volume declared in docker-compose.yml
#    (nodedr-pos_data) the first time this runs.
docker compose up -d

# 4. (optional) Watch the logs until you see "listening on port 4000"
#    and the Next.js server ready message.
docker compose logs -f

# 5. (later) Stop the stack without deleting your data:
docker compose down
```

Then open **http://localhost:1994**. The first launch walks you through:

1. **Admin account** — your name, email, and password.
2. **Shop setup** — shop name, address, currency symbol, low-stock threshold.
3. You're dropped onto the dashboard, ready to add products and sell.

All data (the SQLite database and the auto-generated session secret) lives
in the **`nodedr-pos_data` Docker volume**, not inside the containers, so it
survives `docker compose down`, container recreation, and image rebuilds.
It's only removed if you explicitly delete it (see
[Resetting](#resetting--clearing-data) below).

Want the web UI on a different port? Change the left-hand side of
`"1994:3000"` under the `frontend` service's `ports:` in `docker-compose.yml`,
and update `FRONTEND_ORIGIN` under the `backend` service to match (it's used
for CORS, so the two must agree).

## Hardware setup

### Barcode scanner

No configuration needed. Any USB barcode scanner that acts as a HID
keyboard (i.e. "just types" the barcode followed by Enter — this is true of
the vast majority of consumer scanners) works out of the box. The frontend's
[`useBarcodeScanner`](frontend/hooks/useBarcodeScanner.ts) hook listens for
keystrokes and, based on inter-keystroke timing, tells scanner input apart
from a human typing so it never interferes with normal form fields.

### Thermal printer

The backend talks to the printer directly over USB using raw ESC/POS
commands (via `escpos-usb`), not CUPS or a driver. To wire it up:

1. Find your printer's USB device path on the host, typically
   `/dev/usb/lp0`. If you have multiple USB devices, check `lsusb` and
   `ls /dev/usb/`.
2. Edit `docker-compose.yml` if your path differs from the default:
   ```yaml
   devices:
     - "/dev/usb/lp0:/dev/usb/lp0"
   ```
3. Restart: `docker compose up -d --build backend`.

If no printer is detected at checkout time, the sale still completes — the
backend returns `{ printed: false, reason: "..." }` and the frontend shows a
toast instead of blocking the register. This also means you can develop and
test the whole app on a machine with no printer attached at all.

### Receipt layout

The backend formats a monospace, string-padded receipt so the Price and
Total columns right-align on both 58mm (32-column) and 80mm (48-column)
paper. The layout logic lives in
[`backend/src/lib/receipt.js`](backend/src/lib/receipt.js); the paper cut is
sent as the raw ESC/POS command `0x1D 0x56 0x41 0x00` right after the
receipt body, from [`backend/src/lib/printer.js`](backend/src/lib/printer.js).

```
================================================
                  Raktim Store
                   1 MG Road
                    Pune, MH
             GSTIN: 27ABCDE1234F1Z5
================================================
Date: 11-07-2026 18:06     Bill: #INV-2026-00002
Cust: Rahul
Ph:   9990001111
------------------------------------------------
Item                      Qty     Rate    Amount
------------------------------------------------
Biscuits                    1    50.00     50.00
  GST @ 18%
------------------------------------------------
Subtotal                               Rs. 50.00
CGST                                    Rs. 4.50
SGST                                    Rs. 4.50
Loyalty (100 pts)                     Rs. -10.00
================================================
GRAND TOTAL                            Rs. 49.00
================================================
Paid (UPI)                             Rs. 49.00
------------------------------------------------
         You earned 49 loyalty points!
================================================
            Thank You! Visit Again.
================================================
```

The header, footer, currency, GSTIN, and whether the GST breakdown shows are
all driven by your settings, so this layout adapts to how you configure the
shop.

## Updating

To pull the latest code and redeploy:

```bash
# 1. Get the latest commits
git pull

# 2. Rebuild the images and recreate the containers with the new code.
#    Re-running install.sh does exactly this too.
docker compose up -d --build
```

Your data is safe across updates — the SQLite database and session secret
live in the `nodedr-pos_data` Docker volume, entirely separate from the
container filesystem, so rebuilding or recreating containers never touches
them. Run `docker volume ls` to see it.

## Backing up your data

The database lives inside a Docker-managed volume rather than a plain host
folder, so back it up via a throwaway container that mounts the volume
read-only and copies the file out:

```bash
docker run --rm -v nodedr-pos_data:/data:ro -v "$PWD":/backup alpine \
  cp /data/pos.db /backup/pos-backup-$(date +%Y%m%d).db
```

That drops a timestamped copy of `pos.db` in your current directory on the
host.

## Resetting / clearing data

To wipe everything (admin account, shop settings, products, invoices) and
go through onboarding again — useful after testing, or to start a real shop
from a clean slate:

```bash
# 1. Stop the stack AND remove the named volume (the -v is what deletes
#    the database and session secret; without it, `down` only removes
#    the containers and your data is untouched).
docker compose down -v

# 2. Start back up — a fresh volume is created automatically and
#    you'll land on the onboarding wizard again.
docker compose up -d
```

To remove the volume without also touching the containers:
`docker volume rm nodedr-pos_data` (stack must be stopped first).

If you only want to clear the *catalog and sales history* but keep your
admin login and shop settings, don't delete the files — instead delete
products/invoices from inside the app (Inventory page), since there's no
current admin-account-preserving "factory reset" endpoint.

## Project structure

```
nodedr-pos/
├── docker-compose.yml         # declares the nodedr-pos_data named volume
├── backend/
│   ├── Dockerfile
│   ├── prisma/schema.prisma  # User, ShopSettings, Product, Invoice, InvoiceItem
│   └── src/
│       ├── server.js
│       ├── routes/           # auth, settings, products, invoices, print
│       ├── middleware/auth.js
│       └── lib/              # prisma client, JWT secret, receipt formatting, printer driver
└── frontend/
    ├── Dockerfile
    ├── next.config.ts        # /api → backend proxy (rewrites)
    ├── app/
    │   ├── onboarding/, login/                         # unauthenticated flows
    │   └── (app)/dashboard, pos, inventory, customers, sales, settings
    ├── components/           # AppShell, AuthGate, ProductModal, Toast, ui/*
    └── hooks/                # useBarcodeScanner, useProducts, useCustomers, useInvoices, useAuth, useShopSettings
```

## Local development (without Docker)

Run the backend and frontend in two terminals.

```bash
# Terminal 1 — backend on :4000
cd backend
cp .env.example .env
npm install
npm run prisma:migrate:dev
npm run dev

# Terminal 2 — frontend on :1994 (proxies /api to the backend)
cd frontend
npm install
BACKEND_URL=http://localhost:4000 npm run dev
```

Open `http://localhost:1994`. The browser only talks to :1994; the Next.js
dev server proxies `/api/*` to `BACKEND_URL` (default `http://localhost:4000`).
No API URL is ever baked into the browser bundle.

## API overview

All endpoints are under `/api` and reached through the frontend proxy at
`http://<machine>:1994/api`. Except `/auth/status`, `/auth/login`,
`/auth/register`, and the one-time `POST /settings`, every route requires the
`nodedr_session` cookie; admin-only routes also require the `admin` role.

| Method & path                  | Purpose                                  |
| ------------------------------- | ----------------------------------------- |
| `GET /auth/status`              | Whether an admin account exists yet       |
| `POST /auth/register`           | Onboarding — create the first admin (once) |
| `POST /auth/login` / `/logout`  | Session management                        |
| `POST /auth/change-password`    | Change your own password                  |
| `GET/POST/PUT /auth/users`      | Staff account management (**admin only**) |
| `GET/POST/PUT /settings`        | Company/currency/GST/loyalty/receipt config (PUT is **admin only**) |
| `GET/POST/PUT/DELETE /products` | Catalog CRUD, `+/barcode/:code`, `/low-stock` |
| `GET/POST/PUT /customers`       | Customer directory, `+/phone/:phone` lookup |
| `POST /invoices`                | Finalize a sale — server computes price, tax, discount, loyalty; decrements stock; all transactional |
| `GET /invoices`, `/invoices/summary`, `/invoices/:id` | Sales history & dashboard totals |
| `POST /print`                   | Format + send an invoice to the thermal printer |

## Security

Security posture (verified end-to-end):

- **Passwords**: bcrypt (cost 12); login is timing-uniform and returns an
  identical error for unknown-user vs wrong-password. Login is rate-limited
  (10 / 15 min) on top of a global limiter (300 req/min).
- **Sessions**: `HttpOnly`, `SameSite=Lax` JWT cookie (`HS256`, algorithm
  pinned). Every request re-checks the account still exists and is active, so
  disabling a staff member logs them out immediately. Set `COOKIE_SECURE=true`
  when serving over HTTPS.
- **Authorization**: all data routes require auth; settings and staff
  management require the `admin` role. The last active admin can't be demoted
  or disabled.
- **Server-authoritative money**: prices, tax, discount caps, loyalty value,
  and change are always computed server-side from the catalog and settings —
  the client only sends product ids, quantities, and intent, so a tampered
  request can't alter what a sale charges. Redeemable points are capped at the
  customer's balance.
- **Input validation**: every write endpoint validates with Zod (allowlisted
  fields — no mass assignment); all DB access is parameterized via Prisma.
- **Reduced surface**: the backend is not published to the host — only the
  frontend (:1994) is reachable, and it proxies to the backend privately.
  Helmet sets `X-Content-Type-Options`, `X-Frame-Options`, etc.
- **Secrets**: the JWT signing secret is auto-generated on first boot and
  stored (mode 600) in the data volume — never in the repo.

Designed for a **trusted local network** (a shop's LAN or a single machine).
It's HTTP by default; if you expose it beyond the counter, terminate HTTPS in
front of it and set `COOKIE_SECURE=true`.

## Contributing

Issues and PRs are welcome. This is a small, focused tool — please keep
contributions aligned with "offline-first single-shop POS" rather than
expanding scope into multi-tenant/cloud territory.

## License

[MIT](LICENSE)
