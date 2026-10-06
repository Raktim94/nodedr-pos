const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireApiKey } = require('../middleware/apiKeyAuth');
const { notifyStockChange } = require('../lib/webhooks');
const { receiptUrl } = require('../lib/publicLink');
const { createExternalBill, publicInvoice, findOwnBill } = require('../lib/externalBills');
const orders = require('../lib/orders');
const { qtySchema } = require('../lib/qty');
const { buildInvoicePdf } = require('../lib/pdfInvoice');
const { buildReceiptPdf } = require('../lib/pdf');
const { lookupWarranty } = require('../lib/warranty');

const router = express.Router();

// This is the one surface in the app meant to be reachable from the public
// internet (an external storefront calling in), not just the shop LAN — so
// it gets its own, stricter rate limit on top of the app-wide one in
// server.js, keyed by IP since a bad/leaked key could otherwise be hammered
// from a single source before the per-key nature of auth even matters.
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — slow down.' },
  })
);

function publicProduct(p) {
  return {
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    stock: p.stock,
    unit: p.unit,
    sellingPrice: p.sellingPrice,
    taxRate: p.taxRate,
    trackSerial: p.trackSerial,
    warrantyMonths: p.warrantyMonths,
    updatedAt: p.updatedAt,
  };
}

const baseUrl = (req) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

// GET /api/external/products — every product linked to an external SKU.
// Read-only: any valid, non-revoked key can call this.
// Paginated (limit ≤ 500) and incremental: ?updatedSince=<ISO> returns only
// what changed, so a storefront syncing every minute transfers almost nothing.
router.get('/products', requireApiKey({ scope: 'products:read' }), async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = { sku: { not: null } };
  if (req.query.updatedSince) {
    const d = new Date(String(req.query.updatedSince));
    if (!Number.isNaN(d.getTime())) where.updatedAt = { gt: d };
  }
  if (req.query.q) where.name = { contains: String(req.query.q).slice(0, 80) };
  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { id: 'asc' }, take: limit, skip: offset }),
    prisma.product.count({ where }),
  ]);
  res.set('X-Total-Count', String(total));
  // `available` = stock minus units reserved by open orders.
  const held = await orders.reservedByProduct(prisma, products.map((p) => p.id));
  res.json(products.map((p) => ({ ...publicProduct(p), available: Math.max(0, p.stock - (held.get(p.id) || 0)) })));
});

// GET /api/external/products/:sku — single lookup, for a storefront that
// wants live stock for one product page rather than pulling the whole list.
router.get('/products/:sku', requireApiKey({ scope: 'products:read' }), async (req, res) => {
  // SKU first, then barcode — a storefront may only know one of them.
  // Only SKU-linked products are ever exposed: a product with no SKU stays invisible.
  const product = await prisma.product.findFirst({ where: { sku: { not: null }, OR: [{ sku: req.params.sku }, { barcode: req.params.sku }] } });
  if (!product) return res.status(404).json({ error: 'No product linked to that SKU' });
  res.json(publicProduct(product));
});

const stockSchema = z
  .object({
    // Relative change (e.g. -2 for "2 units just sold externally"), OR an
    // absolute value — exactly one of the two, never both, so a caller
    // can't send an ambiguous request.
    delta: z.number().min(-1_000_000).max(1_000_000).optional(),
    set: z.number().min(0).max(1_000_000).optional(),
    // Optional: makes a retried call (e.g. a webhook handler retrying after
    // a timeout) safe to send again without double-applying the change.
    // Kept in-memory only (see idempotencyCache below) — cheap and correct
    // for this app's single-process deployment; a repeat after a backend
    // restart re-applies once, which is an acceptable, documented edge case.
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .refine((d) => (d.delta !== undefined) !== (d.set !== undefined), {
    message: 'Send exactly one of "delta" or "set"',
  });

// Idempotency cache: idempotencyKey -> { status, body, expiresAt }. Cleared
// lazily on each write rather than a background timer, matching the
// in-memory pattern already used for login/password-confirm throttling
// elsewhere in this codebase (see middleware/auth.js).
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const idempotencyCache = new Map();

function pruneIdempotencyCache() {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache) {
    if (entry.expiresAt < now) idempotencyCache.delete(key);
  }
}

// PATCH /api/external/products/:sku/stock — an external system reporting
// its own sale (or a stock correction) against this shop's inventory.
// Requires a write-scoped key. Fully transactional and re-checks
// allowNegativeStock the same way an in-store checkout does, so an
// external sale can't push stock below zero any more freely than a POS
// sale could.
router.patch('/products/:sku/stock', requireApiKey({ scope: 'stock:write' }), async (req, res) => {
  const parsed = stockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const { delta, set, idempotencyKey } = parsed.data;

  pruneIdempotencyCache();
  if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
    const cached = idempotencyCache.get(idempotencyKey);
    return res.status(cached.status).json(cached.body);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { sku: req.params.sku } });
      if (!product) throw Object.assign(new Error('No product linked to that SKU'), { status: 404 });

      if (product.trackSerial) {
        throw Object.assign(new Error(`"${product.name}" is serial/IMEI-tracked — stock follows its registered units`), { status: 409 });
      }
      const nextStock = set !== undefined ? set : product.stock + delta;
      if (nextStock < 0) {
        const settings = await tx.shopSettings.findFirst();
        if (!settings?.allowNegativeStock) {
          throw Object.assign(
            new Error(`Insufficient stock for "${product.name}" (have ${product.stock}, requested change ${delta ?? `set ${set}`})`),
            { status: 409 }
          );
        }
      }

      return tx.product.update({ where: { id: product.id }, data: { stock: Math.max(0, nextStock) } });
    });

    const body = publicProduct(updated);
    if (idempotencyKey) {
      idempotencyCache.set(idempotencyKey, { status: 200, body, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
    }
    // Broadcast the new stock level to every OTHER integration's webhook
    // (including this same one — harmless, since a webhook receiver should
    // treat "set stock to N" as idempotent by SKU regardless of source).
    notifyStockChange([{ sku: updated.sku, stock: updated.stock }]);
    res.json(body);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    const body = { error: err.message || 'Stock update failed' };
    if (idempotencyKey && status < 500) {
      idempotencyCache.set(idempotencyKey, { status, body, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
    }
    res.status(status).json(body);
  }
});

// ---- Bills -----------------------------------------------------------

// POST /api/external/bills — an e-commerce store takes a bill from the POS.
// Prices, GST, discounts and stock are all decided here from the catalog;
// the caller only names products and quantities.
router.post('/bills', requireApiKey({ scope: 'bills:write' }), async (req, res) => {
  try {
    const out = await createExternalBill(req.body, req.apiKey, baseUrl(req));
    res.status(out.deduplicated ? 200 : 201).json(out);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    const body = { error: status === 500 ? 'Bill failed' : err.message };
    if (err.details) body.details = err.details;
    res.status(status).json(body);
  }
});

router.get('/bills/:ref', requireApiKey({ scope: 'bills:read' }), async (req, res) => {
  const inv = await findOwnBill(req.apiKey.id, req.params.ref);
  if (!inv) return res.status(404).json({ error: 'Bill not found' });
  res.json({ invoice: publicInvoice(inv), receiptUrl: receiptUrl(baseUrl(req), inv.id) });
});

router.get('/bills/:ref/pdf', requireApiKey({ scope: 'bills:read' }), async (req, res) => {
  const inv = await findOwnBill(req.apiKey.id, req.params.ref);
  if (!inv) return res.status(404).json({ error: 'Bill not found' });
  const shop = await prisma.shopSettings.findFirst();
  const layout = req.query.layout === 'receipt' ? 'receipt' : req.query.layout === 'a4' ? 'a4' : shop?.invoiceLayout;
  const pdf = layout === 'a4' ? await buildInvoicePdf({ shop, invoice: inv }) : await buildReceiptPdf({ shop, invoice: inv });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${inv.invoiceNumber}.pdf"` });
  res.send(pdf);
});

// GET /api/external/warranty/:serial — warranty status from an IMEI/serial.
// Buyer name/phone are omitted unless the unit was billed through this key.
router.get('/warranty/:serial', requireApiKey({ scope: 'warranty:read' }), async (req, res) => {
  const w = await lookupWarranty(req.params.serial, { includePrivate: false });
  if (!w) return res.status(404).json({ error: 'No unit with that serial/IMEI' });
  res.json(w);
});

// ---- Orders (click-and-collect / delivery) -----------------------------------
// An order reserves stock without billing; the shop bills it on hand-over.
const orderSchema = z.object({
  externalId: z.string().trim().min(1).max(120),
  fulfilment: z.enum(['PICKUP', 'DELIVERY']).default('PICKUP'),
  customer: z.object({ name: z.string().trim().max(160).optional(), phone: z.string().trim().max(30).optional(), email: z.string().trim().max(200).optional() }).optional(),
  items: z.array(z.object({ sku: z.string().trim().min(1).max(64).optional(), barcode: z.string().trim().min(1).max(64).optional(), quantity: qtySchema }).refine((i) => i.sku || i.barcode, { message: 'sku or barcode required' })).min(1).max(200),
  note: z.string().trim().max(300).optional(),
  paid: z.boolean().default(false),
  paymentRef: z.string().trim().max(120).optional(),
});

router.post('/orders', requireApiKey({ scope: 'orders:write' }), async (req, res) => {
  const p = orderSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid input', details: p.error.flatten() });
  try {
    const codes = [...new Set(p.data.items.flatMap((i) => [i.sku, i.barcode].filter(Boolean)))];
    const products = await prisma.product.findMany({ where: { sku: { not: null }, OR: [{ sku: { in: codes } }, { barcode: { in: codes } }] } });
    const items = p.data.items.map((i) => {
      const pr = products.find((x) => (i.sku && x.sku === i.sku) || (i.barcode && x.barcode === i.barcode));
      if (!pr) throw Object.assign(new Error(`No product found for ${i.sku || i.barcode}`), { status: 404 });
      return { productId: pr.id, quantity: i.quantity };
    });
    const { order, deduplicated } = await orders.createOrder({ ...p.data, items, channel: 'API', apiKeyId: req.apiKey.id });
    res.status(deduplicated ? 200 : 201).json({ deduplicated, order: orders.publicOrder(order) });
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Order failed' });
  }
});

async function findOwnOrder(req) {
  const ref = String(req.params.ref);
  return prisma.order.findFirst({ where: { apiKeyId: req.apiKey.id, OR: [{ externalId: ref }, ...(Number.isInteger(Number(ref)) ? [{ id: Number(ref) }] : [])] }, include: { items: true } });
}

router.get('/orders/:ref', requireApiKey({ scope: 'orders:write' }), async (req, res) => {
  const o = await findOwnOrder(req);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  res.json(orders.publicOrder(o));
});

router.post('/orders/:ref/cancel', requireApiKey({ scope: 'orders:write' }), async (req, res) => {
  const o = await findOwnOrder(req);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  try {
    res.json(orders.publicOrder(await orders.setStatus(o.id, 'CANCELLED')));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
