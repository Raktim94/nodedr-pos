# nodedr-pos

A free, open-source, **fully offline** Point of Sale and inventory management
system for small retail shops. It runs entirely on a local machine via
Docker — no internet connection, no subscription, no cloud dependency, and
no data ever leaves the shop.

Built for a barcode-scanner-and-thermal-printer counter setup: scan an item
to sell it, press Enter to check out, and a receipt prints automatically.

## Features

- **Submify-style onboarding** — first launch walks you through creating an
  admin account and configuring your shop (name, address, currency, low
  stock threshold) before you ever see the dashboard.
- **Barcode-driven POS checkout** — scan an item to add it to the cart, scan
  again to bump the quantity, hit **Enter** to finalize the sale. Unknown
  barcodes surface a toast instead of blocking the register.
- **Inventory management** — scan a known barcode to jump straight to
  editing its stock; scan an unknown one and the "Add Product" form opens
  pre-filled with that barcode.
- **Low stock alerts** — a dashboard widget flags every product at or below
  your configured threshold.
- **Thermal receipt printing** — checkout automatically formats and prints a
  58/80mm ESC/POS receipt (see [layout](#receipt-layout)) and cuts the paper.
- **Zero external calls at runtime** — once the Docker images are built, the
  app never talks to anything outside your machine.

## Architecture

```
┌─────────────────────┐      HTTP (LAN/localhost)      ┌──────────────────────┐
│   frontend (:1994)  │ ──────────────────────────────▶ │   backend (:4000)    │
│   Next.js / React    │ ◀────────────────────────────── │   Express + Prisma   │
└─────────────────────┘        JSON + cookie auth        └──────────┬───────────┘
                                                                     │
                                                        ┌────────────┼────────────┐
                                                        ▼                         ▼
                                              SQLite (nodedr-pos_data)     USB thermal printer
                                              (named Docker volume)        (device passthrough)
```

The backend and frontend are **two separate containers**, not one combined
image. This is a deliberate deviation from a single-container setup: only
the backend needs raw USB access to the printer, so only its container runs
`privileged: true` with a device mapping. The frontend stays an ordinary,
unprivileged container. Everything still comes up with a single
`docker compose up`.

## Tech stack

| Layer      | Choice                                                  |
| ---------- | -------------------------------------------------------- |
| Frontend   | Next.js (App Router), React, TypeScript, Tailwind CSS     |
| Data layer | TanStack Query, react-hook-form + Zod                    |
| Backend    | Node.js, Express, Zod validation                          |
| Database   | SQLite via Prisma ORM, persisted in a Docker volume        |
| Auth       | bcrypt password hashing, httpOnly JWT session cookie       |
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
                   Shop Name
                Shop Address Line 1
================================================
Date: 11-07-2026           Bill: #INV-2026-00001
Cust: Walk-in Customer
------------------------------------------------
Item Name                    Qty   Price   Total
------------------------------------------------
Widget                         2   20.00   40.00
------------------------------------------------
GRAND TOTAL:                           Rs. 40.00
================================================
            Payment: CASH / UPI Static QR
               Thank You! Visit Again.
================================================
```

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
    ├── app/
    │   ├── onboarding/, login/          # unauthenticated flows
    │   └── (app)/dashboard, pos, inventory  # authenticated app shell
    ├── components/            # AppShell, AuthGate, ProductModal, Toast, ui/*
    └── hooks/                 # useBarcodeScanner, useProducts, useInvoices, useShopSettings
```

## Local development (without Docker)

Backend:

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:migrate:dev
npm run dev          # http://localhost:4000
```

Frontend:

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev           # http://localhost:1994
```

The frontend talks to the backend over plain HTTP with credentialed
`fetch` calls (`NEXT_PUBLIC_API_URL`, default `http://localhost:4000/api`).

## API overview

All endpoints are under `/api` and (except `/auth/*` and the one-time
`POST /settings`) require the `nodedr_session` cookie set on login.

| Method & path                  | Purpose                                  |
| ------------------------------- | ----------------------------------------- |
| `GET /auth/status`              | Whether an admin account exists yet       |
| `POST /auth/register`           | Onboarding step 1 — create the one admin  |
| `POST /auth/login` / `/logout`  | Session management                        |
| `GET/POST/PUT /settings`        | Shop settings (onboarding step 2 + edits) |
| `GET /products`, `/products/barcode/:code`, `/products/low-stock` | Catalog & scanner lookup |
| `POST/PUT/DELETE /products(/:id)` | Manage products                        |
| `POST /invoices`                | Finalize a sale (server-priced, stock-checked, transactional) |
| `POST /print`                   | Format + send a saved invoice to the thermal printer |

## Security notes

- Passwords are hashed with bcrypt (cost 12); only one admin account can
  ever be created (`POST /auth/register` is disabled once a user exists).
- Sessions are httpOnly, `SameSite=Lax` JWT cookies; the signing secret is
  auto-generated on first boot and persisted to `.jwt-secret` in the
  `nodedr-pos_data` volume, alongside the database.
- Item prices are always taken from the server-side product catalog at
  checkout — the client cannot influence what a sale actually charges.
- This app is designed for a **trusted local network** (a shop's own LAN or
  a single machine at `localhost`). It does not ship with HTTPS; don't
  expose it directly to the internet.

## Contributing

Issues and PRs are welcome. This is a small, focused tool — please keep
contributions aligned with "offline-first single-shop POS" rather than
expanding scope into multi-tenant/cloud territory.

## License

[MIT](LICENSE)
