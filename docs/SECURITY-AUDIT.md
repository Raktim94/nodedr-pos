# Security audit — 1.2 changes

Method: the attack classes from Cloudflare's
[security-audit skill](https://github.com/cloudflare/security-audit-skill)
(injection, access control, resource/file handling, crypto & secrets, business
logic, feature abuse/data leakage, chained trust boundaries, obvious things)
applied by hand to everything added in 1.2. The skill's multi-agent harness was
not run; this is a single-reviewer pass using its checklists, with each fix
covered by a regression test in `backend/test/api.test.js` ("security: …").

## Fixed

| # | Finding | Fix |
| --- | --- | --- |
| 1 | `GET /api/settings` returned the whole settings row — including the encrypted card-terminal, SMTP and sync-secret blobs — to any signed-in user, and tax/UPI/e-mail fields to anonymous callers | Secret columns are never returned; anonymous callers get branding fields only |
| 2 | API/MCP barcode lookups reached products that had no SKU, contradicting the "unlinked products are never exposed" rule | All API, bill, order and MCP product access requires a SKU |
| 3 | `order.created/updated` webhooks (customer name/phone) were sent to **every** integration | Delivered only to the key that owns the order |
| 4 | A franchisor (meant to be hub read-only) could read this shop's customers, bills and products | Limited to `/api/hub` and their own session |
| 5 | Two concurrent hand-overs of one order (double click, two tills) could bill it twice and decrement stock twice | The order is claimed with an atomic conditional update before billing; a failed bill releases it |
| 6 | Concurrent bills could collide on the invoice number (`count+1`) or on one `externalRef` and fail with a 500 | Number clashes are retried; an `externalRef` clash returns the winning bill |
| 7 | Transitive dependencies: `proxy-addr` (critical), `source-map-js` (high) | `npm audit fix` — 0 known vulnerabilities in both packages |

## Checked, no change needed

* Signature uploads: PNG/JPEG magic-byte check, 300 KB cap, content-hash file names, strict name regex on read (no traversal), fixed `Content-Type` + `nosniff`; SVG rejected.
* Third-party secrets (terminal, SMTP, sync, store credentials, webhook secrets): AES-256-GCM at rest; key derived from the JWT secret file kept outside the database.
* Signed links (receipts, customer portal): HMAC-SHA256, constant-time compare, expiry, `kind` bound into the payload so one cannot be replayed as the other.
* Store webhooks: HMAC over the raw bytes, timing-safe compare, uniform 404 for unknown/inactive/mismatched integrations, per-integration rate limit, idempotent on the store's order id.
* Branch ⇄ hub sync: AES-GCM authenticated messages, ±10 min timestamp window, uniform 401, hub role gate, transfers applied once (`AppliedTransfer`).
* ZPL/EPL labels: control characters stripped from product text (no printer-command injection).
* Output encoding: receipt HTML escapes all fields (including serials); new React pages render text only; QR-menu print window built with `textContent`.
* Public endpoints (QR menu, order status, portal): rate-limited, catalog-priced server-side, order needs the pickup code, open-order cap.
* Card payments: the server re-verifies the provider's payment status and amount before accepting `CARD`, and a payment id can only be used once.

## Known limits (accepted / for the operator)

* Webhook, SMTP, store and hub URLs are set by an **admin** and fetched by the server; there is no private-address blocking. Treat admin accounts as trusted.
* Customer-portal links last a year and cannot be individually revoked (rotate by changing the JWT secret, which signs out everyone).
* `.xlsx` bulk import is size-limited (8 MB compressed) but not protected against decompression bombs; it requires the *inventory* permission.
* The Stripe/Square, WooCommerce/Shopify outbound, SMTP and hardware paths are unverified against live services (see ROADMAP.md).
* Run the app behind HTTPS if it is reachable from the internet; set `COOKIE_SECURE=true` and `PUBLIC_BASE_URL`.
