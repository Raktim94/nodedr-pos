// WooCommerce / Shopify / generic-store integration:
//   inbound  — signed order webhooks become click-and-collect/delivery orders
//   outbound — stock changes here are pushed to the store's inventory
// Webhook verification and payload normalisation follow the approach used in
// nodedr-invoice's e-commerce service (HMAC over the raw body, per-platform
// header + encoding). Outbound calls are written against the platforms'
// public REST/GraphQL docs but have NOT been run against a live store from
// this repo — pilot with a staging store first.
const crypto = require('crypto');
const prisma = require('./prisma');
const { encrypt, decrypt, decryptJson } = require('./secretBox');
const { createOrder } = require('./orders');

const SCHEMES = {
  shopify: { header: 'x-shopify-hmac-sha256', encoding: 'base64', channel: 'SHOPIFY' },
  woocommerce: { header: 'x-wc-webhook-signature', encoding: 'base64', channel: 'WOOCOMMERCE' },
  generic: { header: 'x-webhook-signature', encoding: 'hex', channel: 'GENERIC' },
};

const newWebhookSecret = () => `whsec_${crypto.randomBytes(32).toString('base64url')}`;

// rawBody MUST be the exact received bytes — re-serialising parsed JSON does
// not reproduce them (key order, whitespace, escapes).
function verifySignature(platform, rawBody, headerValue, secret) {
  const scheme = SCHEMES[platform];
  if (!scheme || !headerValue || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  let actual;
  try {
    actual = Buffer.from(String(headerValue).trim(), scheme.encoding);
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const str = (v) => (typeof v === 'string' ? v : undefined);

function normalize(platform, p) {
  if (platform === 'shopify') {
    const c = p.customer || {};
    const ship = p.shipping_address || {};
    return {
      externalId: String(p.id ?? p.order_number ?? ''),
      customer: { name: [c.first_name, c.last_name].filter(Boolean).join(' ') || str(p.email) || 'Shopify customer', phone: str(c.phone) || str(ship.phone), email: str(p.email) },
      lines: (Array.isArray(p.line_items) ? p.line_items : []).map((l) => ({ sku: str(l.sku), quantity: Number(l.quantity) || 1 })),
      paid: p.financial_status === 'paid',
      fulfilment: p.shipping_lines?.length ? 'DELIVERY' : 'PICKUP',
      note: str(p.note),
    };
  }
  if (platform === 'woocommerce') {
    const b = p.billing || {};
    return {
      externalId: String(p.id ?? ''),
      customer: { name: [b.first_name, b.last_name].filter(Boolean).join(' ') || str(b.email) || 'WooCommerce customer', phone: str(b.phone), email: str(b.email) },
      lines: (Array.isArray(p.line_items) ? p.line_items : []).map((l) => ({ sku: str(l.sku), quantity: Number(l.quantity) || 1 })),
      paid: ['processing', 'completed'].includes(p.status),
      fulfilment: Array.isArray(p.shipping_lines) && p.shipping_lines.length ? 'DELIVERY' : 'PICKUP',
      note: str(p.customer_note),
    };
  }
  // generic: { id, customer:{name,phone,email}, items:[{sku,quantity}], paid, note }
  return {
    externalId: String(p.id ?? p.externalId ?? ''),
    customer: p.customer || {},
    lines: (Array.isArray(p.items) ? p.items : []).map((l) => ({ sku: str(l.sku), quantity: Number(l.quantity) || 1 })),
    paid: Boolean(p.paid),
    fulfilment: p.fulfilment === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
    note: str(p.note),
  };
}

/** Process a verified webhook payload. Returns { ignored } or { order }. */
async function ingest(integration, payload) {
  const n = normalize(integration.platform, payload);
  if (!n.externalId || n.lines.length === 0) throw Object.assign(new Error('Unrecognised order payload'), { status: 400 });
  const skus = [...new Set(n.lines.map((l) => l.sku).filter(Boolean))];
  const products = await prisma.product.findMany({ where: { sku: { in: skus } } });
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const items = [];
  const unmatched = [];
  for (const l of n.lines) {
    const p = l.sku && bySku.get(l.sku);
    if (p) items.push({ productId: p.id, quantity: l.quantity });
    else unmatched.push(l.sku || '(no sku)');
  }
  if (items.length === 0) return { ignored: 'No line item matches a product SKU in this POS' };
  const note = [n.note, unmatched.length ? `Items not in POS (SKU): ${unmatched.join(', ')}` : ''].filter(Boolean).join(' | ') || null;
  const { order, deduplicated } = await createOrder({
    channel: SCHEMES[integration.platform].channel,
    externalId: n.externalId,
    fulfilment: n.fulfilment,
    customer: n.customer,
    items,
    note,
    paid: n.paid,
  });
  return { order, deduplicated };
}

// ---------------- outbound stock push ----------------

async function basicFetch(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return json;
}

async function pushWoo(cfg, sku, stock) {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
  const headers = { Authorization: auth, 'Content-Type': 'application/json' };
  const found = await basicFetch(`${base}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`, { headers });
  const product = Array.isArray(found) ? found[0] : null;
  if (!product) return;
  await basicFetch(`${base}/wp-json/wc/v3/products/${product.id}`, { method: 'PUT', headers, body: JSON.stringify({ manage_stock: true, stock_quantity: Math.max(0, Math.floor(stock)) }) });
}

async function pushShopify(cfg, sku, stock) {
  const url = `https://${cfg.shopDomain}/admin/api/2024-10/graphql.json`;
  const headers = { 'X-Shopify-Access-Token': cfg.accessToken, 'Content-Type': 'application/json' };
  const q = await basicFetch(url, { method: 'POST', headers, body: JSON.stringify({ query: `query($q:String!){productVariants(first:1,query:$q){nodes{inventoryItem{id}}}}`, variables: { q: `sku:${JSON.stringify(sku)}` } }) });
  const itemId = q?.data?.productVariants?.nodes?.[0]?.inventoryItem?.id;
  if (!itemId) return;
  await basicFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: `mutation($input:InventorySetQuantitiesInput!){inventorySetQuantities(input:$input){userErrors{message}}}`,
      variables: { input: { name: 'available', reason: 'correction', ignoreCompareQuantity: true, quantities: [{ inventoryItemId: itemId, locationId: cfg.locationId, quantity: Math.max(0, Math.floor(stock)) }] } },
    }),
  });
}

// Debounced + coalesced: a burst of sales touching the same SKU produces one
// outbound call per SKU, a couple of seconds later, keeping the till light.
const pending = new Map();
let timer = null;

function pushStock(changes) {
  for (const c of changes) if (c.sku) pending.set(c.sku, c.stock);
  if (!timer) timer = setTimeout(flush, 2500).unref();
}

async function flush() {
  timer = null;
  const batch = [...pending.entries()];
  pending.clear();
  if (batch.length === 0) return;
  let integrations;
  try {
    integrations = await prisma.integration.findMany({ where: { active: true, configEnc: { not: null }, platform: { in: ['woocommerce', 'shopify'] } } });
  } catch {
    return;
  }
  for (const it of integrations) {
    const cfg = decryptJson(it.configEnc);
    if (!cfg) continue;
    for (const [sku, stock] of batch) {
      try {
        if (it.platform === 'woocommerce' && cfg.baseUrl) await pushWoo(cfg, sku, stock);
        if (it.platform === 'shopify' && cfg.shopDomain) await pushShopify(cfg, sku, stock);
      } catch (err) {
        console.error(`stock sync to "${it.name}" failed for ${sku}: ${err.message}`);
      }
    }
  }
}

module.exports = { SCHEMES, newWebhookSecret, verifySignature, normalize, ingest, pushStock, encrypt, decrypt };
