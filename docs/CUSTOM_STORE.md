# Connect your own website (custom e-commerce)

You can build any storefront — plain HTML + a backend, Next.js, Laravel, Django,
a mobile app — and connect it to NodeDR POS with a small REST API. Your website
takes the order **and the payment and issues the customer's invoice**; the POS
only reserves stock, lets the shop pack and hand the order over, and tells your
site every time the status changes. **The POS never bills online orders.**

```
 your website ──POST /api/external/orders──▶  POS  (reserves stock, returns a pickup code)
 your website ◀── order.updated webhook ─────  POS  (packing → ready → collected / cancelled)
 your website ──GET  /api/external/products─▶  POS  (live price & stock for your catalogue)
```

Base URL: `http://<pos-machine>:1994/api/external` (use your HTTPS address when
the POS is public). Every call needs `Authorization: Bearer nk_live_…`.

## 1. One-time setup (in the POS)

1. Give each product you sell online a **SKU** (Inventory → edit product). Only
   products with a SKU are visible to the API — that is how your site's product
   ids match the POS.
2. **Settings → Integrations → New API key.** Tick the scopes you need:
   `products:read` (catalogue + stock) and `orders:write` (orders). Copy the key
   — it is shown once.
3. Optional, for push updates: set the key's **webhook URL** (`https://…`) to an
   endpoint on your website and keep the **webhook secret** it shows.

## 2. Read your catalogue and stock

```bash
curl -H "Authorization: Bearer $KEY" "http://192.168.1.40:1994/api/external/products?limit=200"
```

Each row has `sku`, `name`, `sellingPrice`, `taxRate`, `stock` and `available`. **Show `available`**
to shoppers: it is stock minus what open online orders have already reserved.
Poll with `updatedSince=<ISO date>` to fetch only what changed.

## 3. Send an order

```bash
curl -X POST http://192.168.1.40:1994/api/external/orders \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "externalId": "web-1001",
    "fulfilment": "PICKUP",
    "customer": { "name": "Meena", "phone": "9876500000", "email": "meena@example.com" },
    "items": [ { "sku": "COLA-1", "quantity": 2 } ],
    "paid": true,
    "note": "Please pack cold"
  }'
```

* `fulfilment` is `PICKUP` (default) or `DELIVERY`.
* `paid` is just information for the shop ("Paid" badge) — no payment is taken.
* `externalId` is **your** order number. Sending the same one again is safe: you
  get the original order back with `"deduplicated": true` (retry on timeouts).
* Success `201` returns `{ order: { id, pickupCode, status: "NEW", total, items, … } }`.
  Show the `pickupCode` (6 characters) to the customer — the shop looks the
  order up with it. `total` is calculated from the POS prices.
* Errors: `404` unknown SKU, `409` not enough available stock, `400` bad input,
  `401/403` bad key or missing scope. Nothing is reserved on an error.

## 4. Follow the order (webhook or polling)

The shop moves the order on the **Online orders** board:
`NEW → PACKING → READY → COLLECTED`, or `CANCELLED`. Each change is sent to your
webhook URL as a signed POST:

```json
{ "event": "order.updated", "timestamp": "2026-10-07T09:30:00.000Z",
  "data": { "id": 41, "externalId": "web-1001", "status": "READY", "previousStatus": "PACKING",
            "pickupCode": "K7M2QX", "total": 540, "paid": true, "items": [ … ] } }
```

Verify the signature — HMAC-SHA256 of the **raw** body with your webhook secret,
sent as `X-Nodedr-Signature: sha256=<hex>`:

```js
// Node / Express — use express.raw() so you keep the exact bytes
const crypto = require('crypto');
function verify(rawBody, header, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return header && header.length === expected.length &&
         crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

Respond `2xx` quickly. Failed deliveries are retried 4 times (2 s, 6 s, 18 s
apart). If your site was down for longer, catch up with:

```bash
curl -H "Authorization: Bearer $KEY" \
  "http://192.168.1.40:1994/api/external/orders?updatedSince=2026-10-07T00:00:00Z"
```

Other calls: `GET /orders/:ref` (your `externalId` or the POS id) and
`POST /orders/:ref/cancel` (only while the order is not yet collected).

## 5. What happens at the shop

When the customer arrives with the pickup code, staff press **Hand over**. That
takes the items out of stock, marks the order `COLLECTED` and fires
`order.updated` to your site. Nothing is billed or printed by the POS — mark your
own invoice paid/fulfilled when you receive `COLLECTED`.

## Python example

```python
import requests
KEY, BASE = "nk_live_…", "http://192.168.1.40:1994/api/external"
H = {"Authorization": f"Bearer {KEY}"}
r = requests.post(f"{BASE}/orders", headers=H, timeout=10, json={
    "externalId": "web-1002", "customer": {"name": "Ravi", "phone": "9876500001"},
    "items": [{"sku": "COLA-1", "quantity": 1}], "paid": False})
r.raise_for_status()
print(r.json()["order"]["pickupCode"])
```

## Don't want to write code?

WooCommerce and Shopify connect with a signed webhook instead (Settings →
Online stores). A different platform that can send webhooks can use the
**Custom website (signed webhook)** option there. See [API.md](API.md) for the
complete reference, including the MCP endpoint for AI agents.
