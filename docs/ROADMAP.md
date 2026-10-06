# Roadmap status

Everything below ships in this codebase. "Verified" means exercised by the
automated test suite (`backend/test`, `packaging/tray/test`) or the production
build; "Needs hardware/account" means the code is written to the vendor's
public documentation but could not be exercised against the real device or
service from the development environment — pilot it before relying on it.

| Area | Item | Status |
| --- | --- | --- |
| **v1.1 Desktop** | System tray icon (status, open, restart) — Windows, Linux, macOS | Code + unit tests. GUI not exercised on a real desktop. Bundled into the macOS app and the `.deb`; for Windows run `node packaging/tray/tray.js` (not yet in the NSIS installer) |
| | macOS `.dmg` | Build script + CI workflow. Must be built on macOS (GitHub Actions). Bundles its own Node runtime — **no Docker needed** (Docker Desktop can't be redistributed). Unsigned unless signing secrets are set |
| **v1.2 Payments** | Dynamic UPI QR at checkout (+ on A4 invoice for balance due) | Verified |
| | WhatsApp receipt sharing | Verified (wa.me link + signed PDF link; no WhatsApp Business account needed) |
| | Multi-currency sale (server-side rates, manual or live) | Verified |
| | Stripe Terminal / Square Terminal | **Needs hardware/account** (server verifies the payment with the provider before accepting it) |
| **v1.3 Reporting** | Advanced reports: category revenue, margins, hourly heatmap, day/week/month comparison | Verified |
| | Profit & cost tracking (cost snapshot per sale line) | Verified |
| | Scheduled e-mail reports (own SMTP) | Code verified up to SMTP; **needs a mail account** to confirm delivery |
| | GSTR-1 export (b2b, b2cs, hsn, docs, credit notes) + generic tax summary | Verified output; review with your accountant before filing |
| | Suppliers, reorder points, purchase orders (PDF, receiving) | Verified |
| **v1.4 Hardware** | Cash drawer kick (ESC/POS) | **Needs hardware** |
| | Customer-facing display | Built (BroadcastChannel second window) |
| | Weighing scale (Web Serial) + fractional quantities | Parsing + fractional billing verified; **needs a scale** |
| | Label printing (ZPL / EPL) | Output verified; **needs a label printer** |
| | NFC | USB NFC readers that type a card id (HID) identify loyalty customers. Contactless *payments* need the card terminal above — an NFC reader alone cannot take card payments |
| **v2.0 Teams** | Granular permissions + per-user discount cap | Verified |
| | Shift management (float, pay in/out, counted close, variance) | Verified |
| | Multi-branch inventory, consolidated reporting, stock transfers, franchise (read-only) mode | Verified end-to-end for the encrypted push/ingest path; branches ⇄ hub over a real network not exercised |
| | Optional cloud sync | Delivered as **self-hosted** hub sync: data goes only to a server you run, AES-256-GCM per-branch secret |
| | Customer PWA | Verified API; installable page (service worker + manifest) |
| **v2.1 Omni-channel** | Click-and-collect / delivery orders board for e-commerce orders (API, WooCommerce, Shopify). A food/restaurant QR menu was deliberately **not** included — this is a retail POS | Verified |
| | WooCommerce / Shopify order webhooks (HMAC) | Verified inbound; outbound stock push **needs a live store** |
| **Also added** | Optional IMEI / serial numbers + warranty (Settings → Features, **off by default**): the IMEI is captured when a unit is **sold** — nothing is registered in stock — printed on the bill and looked up later by scan | Verified |
| | Bulk product import (CSV/XLSX, preview → commit) | Verified |
| | External REST API + MCP server (take bills, orders, stock, warranty) | Verified |
| | Authorised-signature upload, A4 tax-invoice PDF | Verified |
| | UI redesign (light forest-green, motion, bento dashboard) | Built and checked in a browser |
