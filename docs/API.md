# External API & MCP

One key, two doors: a REST API for e-commerce stores and an MCP endpoint for AI
agents. Both are authenticated with an API key created in **Settings →
Integrations**, and both expose only what the key's permissions allow.

**Only products that have a SKU are reachable** (set it in Inventory → edit
product). A product without a SKU is invisible to the API and MCP.

## Permissions (scopes)

| Scope | Allows |
| --- | --- |
| `products:read` | List/look up SKU-linked products with live stock and price |
| `stock:write` | Adjust stock (not for IMEI/serial-tracked products) |
| `bills:write` | Take bills — the POS computes price, GST, discount, stock |
| `bills:read` | Read bills **created through the same key** and download their PDFs |
| `orders:write` | Create / read / cancel click-and-collect orders (reserve stock) |
| `warranty:read` | Warranty status from an IMEI / serial number |

## REST (`/api/external`, `Authorization: Bearer nk_live_…`)

| Request | Notes |
| --- | --- |
| `GET /products?limit=200&offset=0&updatedSince=ISO&q=` | Paginated (≤500), incremental; `X-Total-Count` header; each row has `stock` and `available` (stock minus open-order reservations) |
| `GET /products/:skuOrBarcode` | One product |
| `PATCH /products/:sku/stock` | `{delta}` or `{set}`, optional `idempotencyKey` |
| `POST /bills` | `{externalRef, customer:{name,phone}, items:[{sku\|barcode, quantity, serials?}], paymentMethod, amountPaid, discountType, discountValue}` → `201 {invoice, receiptUrl}`. **Idempotent on `externalRef`** (a repeat returns the first bill, `200`, `deduplicated:true`). UPI/CARD are paid in full; CASH uses `amountPaid` (a shortfall needs a customer phone and becomes their due) |
| `GET /bills/:invoiceNumberOrExternalRef` | Only bills made with this key |
| `GET /bills/:ref/pdf?layout=a4\|receipt` | PDF bill |
| `POST /orders` | `{externalId, fulfilment, customer, items:[{sku,quantity}], paid, note}` → reserves stock, returns a `pickupCode`. Idempotent on `externalId` |
| `GET /orders/:ref`, `POST /orders/:ref/cancel` | Own orders only |
| `GET /warranty/:serial` | Product, sale date, warranty end, days left, history (buyer name/phone omitted) |

`receiptUrl` is a signed, expiring (30-day) link to the bill PDF that anyone can
open — share it with the customer.

### Webhooks (optional, per key, `https://` only)

HMAC-SHA256 of the raw body in `X-Nodedr-Signature: sha256=<hex>`.
`stock.updated` (linked products), and — **only to the key that owns the
order** — `order.created` / `order.updated`.

## MCP

* Remote: `POST https://<shop>/mcp` (Streamable HTTP, stateless), `Authorization: Bearer nk_live_…`
* Local desktop client (stdio), on the POS machine:

```json
{ "mcpServers": { "nodedr-pos": {
  "command": "node", "args": ["backend/src/mcp/stdio.js"],
  "env": { "NODEDR_API_KEY": "nk_live_…", "DATABASE_URL": "file:./data/pos.db" } } } }
```

Tools (shown only if the key has the scope): `search_products`, `get_stock`,
`adjust_stock`, `create_bill`, `get_bill`, `create_order`, `get_order`,
`check_warranty`. They call the same services as the REST API and the till, so
money rules are identical.

## Stores (WooCommerce / Shopify / generic)

Settings → Online & menu → Connect. You get a webhook URL and a signing secret
(shown once). Orders become click-and-collect/delivery orders matched by SKU.
Stock changes here are pushed back (debounced, one call per SKU per ~2.5 s).
