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
│   frontend (:3000)  │ ──────────────────────────────▶ │   backend (:4000)    │
│   Next.js / React    │ ◀────────────────────────────── │   Express + Prisma   │
└─────────────────────┘        JSON + cookie auth        └──────────┬───────────┘
                                                                     │
                                                        ┌────────────┼────────────┐
                                                        ▼                         ▼
                                                 SQLite (./data)         USB thermal printer
                                                 (Docker volume)         (device passthrough)
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

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

```bash
git clone <this-repo-url> nodedr-pos
cd nodedr-pos
docker compose up -d --build
```

Then open **http://localhost:3000**. The first launch walks you through:

1. **Admin account** — your name, email, and password.
2. **Shop setup** — shop name, address, currency symbol, low-stock threshold.
3. You're dropped onto the dashboard, ready to add products and sell.

All data (the SQLite database and the auto-generated session secret) lives
in `./data` on the host, so it survives container restarts and rebuilds.

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

## Project structure

```
nodedr-pos/
├── docker-compose.yml
├── data/                     # SQLite DB + session secret (bind-mounted, gitignored)
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
npm run dev           # http://localhost:3000
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
  auto-generated on first boot and persisted to `data/.jwt-secret`.
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
