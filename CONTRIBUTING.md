# Contributing to NodeDR POS

Thanks for considering a contribution to NodeDR POS — a free, offline-first
Point of Sale for small retail shops. This is a small, focused tool with a
real production surface (three install paths — Docker, Windows `.exe`,
Debian `.deb` — all shipping from the same code), so this guide covers
environment setup, the conventions the codebase already leans on, and the
process for issues/PRs.

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Before you start](#before-you-start)
- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Conventions that are not optional](#conventions-that-are-not-optional)
- [Working on hardware features](#working-on-hardware-features)
- [Working on the native installers](#working-on-the-native-installers)
- [Making a change](#making-a-change)
- [Commit messages](#commit-messages)
- [Opening a pull request](#opening-a-pull-request)
- [Reporting bugs](#reporting-bugs)
- [Proposing features](#proposing-features)
- [Questions & discussion](#questions--discussion)

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it. Report unacceptable behavior to
**ranjitraktim5@gmail.com**.

## Maintainers & copyright

See [`MAINTAINERS.md`](./MAINTAINERS.md) — Raktim Ranjit is the lead
maintainer; project copyright is held jointly by
[Nodedr Infotech Private Limited](https://www.nodedr.com/) and Raktim
Ranjit. By submitting a PR, you agree your contribution is licensed under
the same [AGPL-3.0](./LICENSE) as the rest of the project; you retain
copyright on your own contribution.

## Before you start

Read the [`README.md`](./README.md) first, specifically:

- **Architecture** — the one-port, one-origin design (browser only ever
  talks to the frontend on `:1994`; the backend is never published to the
  host) and why.
- **Tech stack** — Next.js/Express/Prisma/SQLite, and where each piece's
  source of truth lives (e.g. currency symbols in
  `backend/src/lib/currency.js`, never duplicated on the frontend).
- **Security** — the actual, verified security posture. Anything you add
  that touches auth, money, or input validation is held to this bar, not
  a lighter one.

This is a **small, focused tool** — keep contributions aligned with
"offline-first single-shop POS" rather than expanding scope into
multi-tenant/cloud territory. If you want to propose something bigger,
see [Proposing features](#proposing-features) first.

## Development setup

**Prerequisites:** Docker (for the quickest path), or Node.js 24+ and a
way to run two terminals for local dev without Docker.

### Option A — Docker (matches production)

```bash
git clone https://github.com/Raktim94/nodedr-pos.git
cd nodedr-pos
./install.sh
```

See the README's [Quick start](./README.md#quick-start) for what this
does step by step, and [Updating](./README.md#updating) for the
rebuild-after-pull-changes loop while you iterate.

### Option B — local dev, no Docker (faster iteration)

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

Open `http://localhost:1994`. The Next.js dev server proxies `/api/*` to
`BACKEND_URL` — no API URL is ever baked into the browser bundle, and
that must stay true for any change you make to the proxy config.

### Before opening a PR, locally run

```bash
cd frontend && npm run lint
cd ../backend && npm run prisma:generate   # confirms schema.prisma is valid
```

There's no backend lint/test suite or CI beyond the Windows installer
build workflow yet — until that changes, manually click through the
feature you touched (see the relevant README section — POS checkout,
returns, printing, etc.) and say what you tested in the PR description.
A real test suite is a good first contribution if you want one.

## Project structure

```
nodedr-pos/
├── docker-compose.yml         # declares the nodedr-pos_data named volume
├── install.sh                 # one-command Docker install/upgrade
├── docs/screenshots/          # README images
├── packaging/                 # .deb (Debian/Ubuntu) and .exe (Windows) installer builds
├── backend/
│   ├── Dockerfile
│   ├── prisma/schema.prisma  # User, ShopSettings, Product, Invoice, InvoiceItem, Return
│   └── src/
│       ├── server.js
│       ├── routes/           # auth, settings, products, invoices, returns, print, masters
│       ├── middleware/auth.js
│       └── lib/              # prisma client, JWT secret, currencies, receipt HTML/PDF, ESC/POS
└── frontend/
    ├── Dockerfile
    ├── next.config.ts        # /api → backend proxy (rewrites)
    ├── app/
    │   ├── page.tsx                                      # public marketing/landing page
    │   ├── onboarding/, login/                           # unauthenticated flows
    │   └── (app)/dashboard, pos, inventory, customers, sales, settings
    ├── components/           # AppShell, ProductModal, BarcodeLabelModal, ReturnPanel, SalesCharts, ...
    ├── lib/                  # api client, format helpers, barcode.ts, masters.ts
    └── hooks/                # useBarcodeScanner, useProducts, useCustomers, useInvoices, useReturns, ...
```

## Conventions that are not optional

These are documented, previously-verified rules. PRs that violate them
will be asked to change before merge:

- **Server-authoritative money, always.** Prices, tax, discount caps,
  loyalty value, and change are computed server-side from the catalog and
  settings — the client only ever sends product ids, quantities, and
  intent. Never move a pricing/tax/discount calculation to the frontend
  "for convenience."
- **GST-inclusive pricing, backed out, never added on top.** The price on
  a product is its MRP, GST-inclusive as required by law. CGST/SGST shown
  on a receipt are a breakdown of tax already inside that price.
- **One currency source of truth.** Currency symbols/formatting live in
  [`backend/src/lib/currency.js`](backend/src/lib/currency.js). Don't
  hardcode a symbol or duplicate the currency list on the frontend.
- **Zod validation on every write endpoint**, allowlisted fields — no mass
  assignment. All DB access goes through Prisma (parameterized), never a
  raw string-built query.
- **Returns/exchange invariants.** Returnable quantity is computed by
  summing every prior `ReturnItem` against an invoice line, never a
  running counter — this is what makes partial and repeat returns safe.
  A refund amount can be lowered by the cashier but never raised above
  what was actually paid. If you touch
  [`backend/src/routes/returns.js`](backend/src/routes/returns.js) or the
  returns handling in `invoices.js`, re-verify both invariants still hold.
- **Receipts stay paper-economical.** No unnecessary margins/padding in
  the HTML receipt template or the PDF renderer — every extra millimetre
  is real, recurring thermal-paper cost for the shop. PDF page height is
  computed per-receipt, not fixed.
- **No API URL baked into the browser bundle.** The frontend only ever
  calls its own `/api/*`, proxied server-side to the backend. Don't add a
  direct-to-backend fetch from client code.

## Working on hardware features

Two hardware integrations have real quirks documented in the README —
read the relevant section before changing either:

- **Barcode scanner** ([`useBarcodeScanner`](frontend/hooks/useBarcodeScanner.ts)) —
  distinguishes scanner input from human typing by inter-keystroke timing.
  Don't add a "press a key to start scanning" mode; the whole point is
  that any HID scanner works with zero configuration.
- **Direct-USB ESC/POS printing** ([`backend/src/lib/escposUsb.js`](backend/src/lib/escposUsb.js)) —
  tries the kernel `usblp` character device first, libusb second. This is
  Linux-only and needs the `/dev/bus/usb` mount + `device_cgroup_rules` in
  `docker-compose.yml` — see [Direct-USB printer setup](./README.md#direct-usb-escpos-printer-setup)
  for the full explanation of why, including why the backend container
  runs as root (it's required, not an oversight — don't "fix" it by
  adding a `USER` line).

## Working on the native installers

The Windows (`.exe`) and Debian (`.deb`) installers are built from the
same `backend`/`frontend` source — see
[`packaging/windows/README.md`](packaging/windows/README.md) and
[`packaging/README.md`](packaging/README.md) for the full build process,
service/systemd-unit layout, and what CI verifies before a release. If you
touch `packaging/debian/copyright` or the `.nsi` script's license/version
metadata, keep them consistent with the root [`LICENSE`](./LICENSE) — the
`Files: *` stanza in `packaging/debian/copyright` describes *our* code and
must match; the stanzas for the bundled Node.js runtime and vendored
`node_modules` describe *their* actual upstream licenses and should not be
changed to match ours.

## Making a change

1. Fork the repo and branch off `master`:
   `git checkout -b feat/short-description` (or `fix/`, `docs/`, `chore/`).
2. Keep the change scoped — a bug fix doesn't need a drive-by refactor.
3. If your change touches money, auth, or the returns/exchange logic,
   say in the PR description how you satisfied the relevant rule above.
4. Update the README if you change a documented behavior (a new setting,
   a changed API route, a new install step) — this project's README is
   the primary user-facing documentation, not a secondary doc.

## Commit messages

Write for the *why*; the diff already shows the *what*.

```
Fix returnable-quantity double-count on repeat partial returns

Returnable quantity was tracked with a running counter on the invoice
line, which double-counted when the same line was partially returned
twice. Switched to summing every prior ReturnItem against the line at
request time, so repeated partial returns compute correctly regardless
of order.
```

No enforced prefix convention — clear prose beats a format. Keep the
subject line under ~70 characters.

## Opening a pull request

- Target the `master` branch.
- Fill in the PR template (what changed, why, how you tested it).
- Run `npm run lint` in `frontend/` — there's no backend lint yet, so for
  backend changes, describe what you manually tested (which endpoint,
  with what request, and what you confirmed in the response/DB).
- Screenshots or a short clip for anything touching `frontend/` UI.
- Link the issue it closes, if any (`Closes #123`).

## Reporting bugs

Open an issue with:

- What you expected vs. what happened.
- Exact repro steps.
- Install method (Docker / Windows `.exe` / Debian `.deb` / local dev)
  and versions (Node, OS, Docker if relevant).
- For a printing bug: which transport (browser Print, Download PDF,
  Print via USB), printer model, and `lsusb` / `dmesg | grep usblp`
  output if it's a direct-USB issue (see
  [Troubleshooting](./README.md#troubleshooting-linux-till)).

Money-correctness bugs (a total that doesn't match line items, a return
that refunds more than was paid, a due/loyalty balance that drifts) are
treated as high priority — flag that in the issue title.

## Proposing features

Check the README's [Features](./README.md#features) list and this repo's
existing issues first — a good rule of thumb is: does it fit "a single
shop's offline counter," or does it start requiring a multi-location/
cloud/subscription model? The latter is explicitly out of scope for this
project (see [`nodedr-restaurant-pos`](https://github.com/Raktim94/nodedr-restaurant-pos)
and other sister projects for adjacent, larger-scope tools). Small,
additive proposals (a new report, a new payment method, a new printer
transport) can go straight to a feature-request issue or a PR.

## Questions & discussion

Use [GitHub Discussions](https://github.com/Raktim94/nodedr-pos/discussions)
for "how do I…" and general chat. Use Issues for concrete bugs and
feature requests.
