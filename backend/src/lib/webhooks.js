const crypto = require('crypto');
const prisma = require('./prisma');

// Fires a signed "a linked product's stock changed" event at every
// registered integration's webhookUrl, so a connected storefront (or any
// other external system) can mirror stock live instead of only polling
// GET /api/external/products. Deliberately fire-and-forget: a slow or
// unreachable webhook target must NEVER delay or fail the POS action
// (a sale, a return, a stock edit) that triggered it — same principle as
// the existing best-effort email/print side effects elsewhere in this app.
//
// Each integration gets its own HMAC secret (ApiKey.webhookSecret) rather
// than one shared server-wide secret, so revoking/rotating one integration
// can never affect another's signature verification.
async function notifyStockChange(changes) {
  if (!changes || changes.length === 0) return;
  // WooCommerce/Shopify inventory push (debounced, see lib/stores.js).
  require('./stores').pushStock(changes);

  let targets;
  try {
    targets = await prisma.apiKey.findMany({
      where: { revoked: false, webhookUrl: { not: null } },
    });
  } catch (err) {
    console.error('notifyStockChange: could not load webhook targets', err);
    return;
  }
  if (targets.length === 0) return;

  const payload = JSON.stringify({
    event: 'stock.updated',
    timestamp: new Date().toISOString(),
    changes: changes.map((c) => ({ sku: c.sku, stock: c.stock })),
  });

  for (const target of targets) {
    if (!target.webhookUrl || !target.webhookSecret) continue;
    sendOne(target.webhookUrl, target.webhookSecret, payload).catch((err) => {
      // Logged only — a dead webhook target must never surface as an error
      // to whatever POS action triggered this (checkout, restock, etc.).
      console.error(`notifyStockChange: delivery to "${target.name}" failed:`, err.message);
    });
  }
}

async function sendOne(url, secret, payload) {
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Nodedr-Signature': `sha256=${signature}`,
    },
    body: payload,
    // A hung external endpoint must not pile up connections/timers forever.
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`webhook target responded ${res.status}`);
  }
}

// Generic signed event delivery to every integration webhook (orders etc.).
// Same fire-and-forget + per-integration HMAC rules as notifyStockChange.
// Order events carry customer details, so they go ONLY to the integration that
// owns the order (`apiKeyId`) — never broadcast to every webhook target.
async function notifyEvent(event, data, { apiKeyId } = {}) {
  if (!apiKeyId) return;
  let targets;
  try {
    targets = await prisma.apiKey.findMany({ where: { id: apiKeyId, revoked: false, webhookUrl: { not: null } } });
  } catch (err) {
    console.error('notifyEvent: could not load webhook targets', err);
    return;
  }
  const payload = JSON.stringify({ event, timestamp: new Date().toISOString(), data });
  for (const t of targets) {
    if (!t.webhookUrl || !t.webhookSecret) continue;
    sendOne(t.webhookUrl, t.webhookSecret, payload).catch((err) => console.error(`notifyEvent: delivery to "${t.name}" failed:`, err.message));
  }
}

module.exports = { notifyStockChange, notifyEvent };
