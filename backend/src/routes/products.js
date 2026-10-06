const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { notifyStockChange } = require('../lib/webhooks');
const { validateSerial } = require('../lib/serials');

const router = express.Router();
router.use(requireAuth);

// No `.default()` here on purpose — see settings.js for why. `.default()`
// fires whenever a key is absent, which would make `productSchema.partial()`
// silently reset taxRate/discountValue/stock to 0 on any partial update
// that omits them (e.g. the Inventory "adjust stock" quick action, which
// only ever sends `{ stock }`). `createSchema` adds the defaults back for
// the POST (create) route, where every field really is required-or-defaulted.
const fields = {
  barcode: z.string().trim().min(1).max(64),
  // Optional key used only to link this product to an external system over
  // the External Stock API (see routes/external.js) — most products never
  // set this. Empty string normalizes to null (Prisma's unique index on a
  // nullable column allows any number of nulls, but not two empty strings).
  sku: z
    .string()
    .trim()
    .max(64)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(80).optional().or(z.literal('')),
  hsn: z.string().trim().max(20).optional().or(z.literal('')),
  unit: z.string().trim().max(10).optional().or(z.literal('')),
  purchasePrice: z.number().min(0),
  sellingPrice: z.number().min(0),
  taxRate: z.number().min(0).max(100),
  // A standing per-product discount — either a percent (capped at 100) or a
  // flat currency amount (capped against sellingPrice, checked in the
  // route below since that needs both fields together, not just one).
  discountType: z.enum(['percent', 'amount']).nullish(),
  discountValue: z.number().min(0),
  stock: z.number().int().min(0),
  trackSerial: z.boolean(),
  warrantyMonths: z.number().int().min(0).max(240),
};
const createSchema = z.object({
  ...fields,
  taxRate: fields.taxRate.default(0),
  discountValue: fields.discountValue.default(0),
  stock: fields.stock.default(0),
  trackSerial: fields.trackSerial.default(false),
  warrantyMonths: fields.warrantyMonths.default(0),
});
const updateSchema = z.object(fields).partial();

function normalizeDiscount(data) {
  // A discountType with no value (or vice versa) doesn't make sense —
  // treat "no type" as "no discount" regardless of what discountValue holds.
  if (!data.discountType) {
    if ('discountType' in data || 'discountValue' in data) {
      data.discountType = null;
      data.discountValue = 0;
    }
    return data;
  }
  if (data.discountType === 'percent' && data.discountValue > 100) {
    throw Object.assign(new Error('Percent discount cannot exceed 100'), { status: 400 });
  }
  if (data.discountType === 'amount' && data.sellingPrice != null && data.discountValue > data.sellingPrice) {
    throw Object.assign(new Error('Flat discount cannot exceed the selling price'), { status: 400 });
  }
  return data;
}

// GET /api/products?q=search
router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const products = await prisma.product.findMany({
    where: q
      ? { OR: [{ name: { contains: q } }, { barcode: { contains: q } }, { category: { contains: q } }] }
      : undefined,
    orderBy: { name: 'asc' },
    take: Math.min(Number(req.query.limit) || 2000, 5000),
    skip: Math.max(Number(req.query.offset) || 0, 0),
  });
  res.json(products);
});

// GET /api/products/low-stock — dashboard widget
router.get('/low-stock', async (req, res) => {
  const settings = await prisma.shopSettings.findFirst();
  const threshold = settings?.lowStockAlert ?? 5;
  const products = await prisma.product.findMany({
    where: { stock: { lte: threshold } },
    orderBy: { stock: 'asc' },
  });
  res.json({ threshold, products });
});

// GET /api/products/barcode/:barcode — scanner lookup
router.get('/barcode/:barcode', async (req, res) => {
  const product = await prisma.product.findUnique({ where: { barcode: req.params.barcode } });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// GET /api/products/scan/:code — ONE lookup for whatever a scanner reads:
// a barcode, an external SKU, or a serial/IMEI. A serial hit returns the
// product plus that exact unit so the POS can add it to the cart in one scan.
router.get('/scan/:code', async (req, res) => {
  const code = String(req.params.code).trim();
  if (!code || code.length > 64) return res.status(400).json({ error: 'Invalid code' });
  let product = await prisma.product.findUnique({ where: { barcode: code } });
  if (!product) product = await prisma.product.findUnique({ where: { sku: code } });
  if (product) return res.json({ type: 'product', product });

  const unit = await prisma.serialUnit.findUnique({ where: { serial: code.toUpperCase().replace(/\s+/g, '') }, include: { product: true } });
  if (unit) {
    const { product: p, ...serial } = unit;
    return res.json({ type: 'serial', product: p, serial });
  }
  res.status(404).json({ error: 'Nothing matches that code' });
});

async function syncSerialStock(tx, productId) {
  const count = await tx.serialUnit.count({ where: { productId, status: 'IN_STOCK' } });
  return tx.product.update({ where: { id: productId }, data: { stock: count } });
}

// GET /api/products/:id/serials?status=IN_STOCK|SOLD|DEFECTIVE
router.get('/:id/serials', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid product id' });
  const status = ['IN_STOCK', 'SOLD', 'DEFECTIVE'].includes(req.query.status) ? req.query.status : undefined;
  const units = await prisma.serialUnit.findMany({
    where: { productId: id, ...(status ? { status } : {}) },
    orderBy: { id: 'desc' },
    take: 1000,
  });
  res.json(units);
});

const serialsSchema = z.object({ serials: z.array(z.string().trim().min(1).max(64)).min(1).max(1000) });

// POST /api/products/:id/serials — receive units (scan or paste a list).
// Bad / duplicate numbers are reported back, valid ones are still saved.
router.post('/:id/serials', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid product id' });
  const parsed = serialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!product.trackSerial) return res.status(409).json({ error: 'Turn on serial/IMEI tracking for this product first' });

  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const raw of parsed.data.serials) {
    const v = validateSerial(raw);
    if (!v.ok) { rejected.push({ serial: raw, reason: v.error }); continue; }
    if (seen.has(v.serial)) { rejected.push({ serial: v.serial, reason: 'Duplicate in this list' }); continue; }
    seen.add(v.serial);
    accepted.push(v.serial);
  }
  const existing = await prisma.serialUnit.findMany({ where: { serial: { in: accepted } }, select: { serial: true } });
  const taken = new Set(existing.map((e) => e.serial));
  const fresh = accepted.filter((s) => !taken.has(s));
  for (const s of accepted) if (taken.has(s)) rejected.push({ serial: s, reason: 'Already registered' });

  const updated = await prisma.$transaction(async (tx) => {
    for (const serial of fresh) {
      const u = await tx.serialUnit.create({ data: { productId: id, serial } });
      await tx.serialEvent.create({ data: { serialId: u.id, type: 'RECEIVED' } });
    }
    return syncSerialStock(tx, id);
  });
  if (updated.sku) notifyStockChange([{ sku: updated.sku, stock: updated.stock }]);
  res.status(201).json({ added: fresh.length, rejected, stock: updated.stock });
});

// PATCH /api/products/serials/:serial — mark a unit DEFECTIVE / back IN_STOCK.
router.patch('/serials/:serial', async (req, res) => {
  const parsed = z.object({ status: z.enum(['IN_STOCK', 'DEFECTIVE']), note: z.string().trim().max(200).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const unit = await prisma.serialUnit.findUnique({ where: { serial: String(req.params.serial).toUpperCase() } });
  if (!unit) return res.status(404).json({ error: 'Serial not found' });
  if (unit.status === 'SOLD') return res.status(409).json({ error: 'A sold unit must be returned through a return, not edited here' });
  await prisma.$transaction(async (tx) => {
    await tx.serialUnit.update({ where: { id: unit.id }, data: { status: parsed.data.status, note: parsed.data.note ?? unit.note } });
    await tx.serialEvent.create({ data: { serialId: unit.id, type: 'NOTE', note: `Marked ${parsed.data.status}${parsed.data.note ? ': ' + parsed.data.note : ''}` } });
    await syncSerialStock(tx, unit.productId);
  });
  res.json({ ok: true });
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const existing = await prisma.product.findUnique({ where: { barcode: parsed.data.barcode } });
  if (existing) return res.status(409).json({ error: 'Barcode already exists', product: existing });
  if (parsed.data.sku) {
    const existingSku = await prisma.product.findUnique({ where: { sku: parsed.data.sku } });
    if (existingSku) return res.status(409).json({ error: 'SKU already linked to another product', product: existingSku });
  }

  let data;
  try {
    data = normalizeDiscount(parsed.data);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const product = await prisma.product.create({ data });
  res.status(201).json(product);
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid product id' });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  let data;
  try {
    data = normalizeDiscount(parsed.data);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  try {
    if ('stock' in data) {
      const cur = await prisma.product.findUnique({ where: { id }, select: { trackSerial: true } });
      if (cur?.trackSerial) {
        return res.status(409).json({ error: 'Stock of a serial/IMEI-tracked product follows its registered units — add or remove units instead' });
      }
    }
    const product = await prisma.product.update({ where: { id }, data });
    if ('stock' in data && product.sku) {
      notifyStockChange([{ sku: product.sku, stock: product.stock }]);
    }
    res.json(product);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'SKU already linked to another product' });
    }
    res.status(404).json({ error: 'Product not found' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid product id' });
  try {
    await prisma.product.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2003') {
      return res
        .status(409)
        .json({ error: 'This product appears on past invoices and cannot be deleted. Set its stock to 0 instead.' });
    }
    res.status(404).json({ error: 'Product not found' });
  }
});

module.exports = router;
