const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { round2 } = require('../lib/pricing');
const { qtySchema, r3 } = require('../lib/qty');
const { validateSerial } = require('../lib/serials');
const { buildPurchaseOrderPdf } = require('../lib/pdfPurchaseOrder');

const router = express.Router();
router.use(requireAuth, requirePerm('purchasing'));

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Request failed' });
  }
};
const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw err('Invalid id');
  return id;
};

// ---- suppliers ----
const supplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().max(200).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  gstin: z.string().trim().max(20).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
router.get('/suppliers', wrap(async (req, res) => res.json(await prisma.supplier.findMany({ orderBy: { name: 'asc' } }))));
router.post('/suppliers', wrap(async (req, res) => {
  const p = supplierSchema.safeParse(req.body);
  if (!p.success) throw err('Invalid input');
  res.status(201).json(await prisma.supplier.create({ data: p.data }));
}));
router.put('/suppliers/:id', wrap(async (req, res) => {
  const p = supplierSchema.partial().safeParse(req.body);
  if (!p.success) throw err('Invalid input');
  try {
    res.json(await prisma.supplier.update({ where: { id: idParam(req) }, data: p.data }));
  } catch (e) {
    if (e.status) throw e;
    throw err('Supplier not found', 404);
  }
}));
router.delete('/suppliers/:id', wrap(async (req, res) => {
  const id = idParam(req);
  if (await prisma.purchaseOrder.count({ where: { supplierId: id } })) throw err('Supplier has purchase orders and cannot be deleted', 409);
  await prisma.product.updateMany({ where: { supplierId: id }, data: { supplierId: null } });
  await prisma.supplier.delete({ where: { id } }).catch(() => { throw err('Supplier not found', 404); });
  res.status(204).end();
}));

// ---- reorder suggestions ----
// Products at/below their reorder point, grouped by supplier, with a
// suggested quantity that brings stock back to twice the reorder point.
router.get('/reorder', wrap(async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT p.id, p.name, p.stock, p.reorderPoint, p.purchasePrice, p.unit, p.supplierId, s.name AS supplierName
    FROM Product p LEFT JOIN Supplier s ON s.id = p.supplierId
    WHERE p.reorderPoint > 0 AND p.stock <= p.reorderPoint ORDER BY s.name, p.name`;
  const groups = new Map();
  for (const r of rows) {
    const key = r.supplierId ?? 0;
    const g = groups.get(key) || { supplierId: r.supplierId, supplierName: r.supplierName || 'No supplier set', items: [] };
    g.items.push({ productId: r.id, name: r.name, stock: r.stock, reorderPoint: r.reorderPoint, unit: r.unit, unitCost: r.purchasePrice, suggestedQty: r3(Math.max(r.reorderPoint * 2 - r.stock, 1)) });
    groups.set(key, g);
  }
  res.json([...groups.values()]);
}));

// ---- purchase orders ----
async function nextNumber(tx) {
  const n = await tx.purchaseOrder.count();
  return `PO-${new Date().getFullYear()}-${String(n + 1).padStart(4, '0')}`;
}
const poSchema = z.object({
  supplierId: z.number().int().positive(),
  notes: z.string().trim().max(500).optional(),
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: qtySchema, unitCost: z.number().min(0).max(100_000_000) })).min(1).max(500),
});
router.post('/orders', wrap(async (req, res) => {
  const p = poSchema.safeParse(req.body);
  if (!p.success) throw err('Invalid input');
  const order = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: p.data.supplierId } });
    if (!supplier) throw err('Supplier not found', 404);
    const products = await tx.product.findMany({ where: { id: { in: p.data.items.map((i) => i.productId) } } });
    const map = new Map(products.map((x) => [x.id, x]));
    const items = p.data.items.map((i) => {
      const prod = map.get(i.productId);
      if (!prod) throw err(`Product ${i.productId} not found`, 404);
      return { productId: i.productId, name: prod.name, quantity: i.quantity, unitCost: i.unitCost };
    });
    return tx.purchaseOrder.create({
      data: { number: await nextNumber(tx), supplierId: supplier.id, notes: p.data.notes || null, totalCost: round2(items.reduce((s, i) => s + i.quantity * i.unitCost, 0)), items: { create: items } },
      include: { items: true, supplier: true },
    });
  });
  res.status(201).json(order);
}));

router.get('/orders', wrap(async (req, res) => {
  const status = ['DRAFT', 'SENT', 'RECEIVED', 'CANCELLED'].includes(req.query.status) ? req.query.status : undefined;
  res.json(await prisma.purchaseOrder.findMany({ where: status ? { status } : undefined, include: { supplier: { select: { name: true } }, _count: { select: { items: true } } }, orderBy: { id: 'desc' }, take: 200 }));
}));

router.get('/orders/:id', wrap(async (req, res) => {
  const o = await prisma.purchaseOrder.findUnique({ where: { id: idParam(req) }, include: { items: true, supplier: true } });
  if (!o) throw err('Not found', 404);
  res.json(o);
}));

router.get('/orders/:id/pdf', wrap(async (req, res) => {
  const [order, shop] = await Promise.all([prisma.purchaseOrder.findUnique({ where: { id: idParam(req) }, include: { items: true, supplier: true } }), prisma.shopSettings.findFirst()]);
  if (!order || !shop) throw err('Not found', 404);
  res.type('application/pdf').set('Content-Disposition', `attachment; filename="${order.number}.pdf"`).send(await buildPurchaseOrderPdf({ shop, order }));
}));

router.patch('/orders/:id/status', wrap(async (req, res) => {
  const p = z.object({ status: z.enum(['SENT', 'CANCELLED']) }).safeParse(req.body);
  if (!p.success) throw err('Invalid status');
  const o = await prisma.purchaseOrder.findUnique({ where: { id: idParam(req) } });
  if (!o) throw err('Not found', 404);
  if (o.status === 'RECEIVED' || o.status === 'CANCELLED') throw err(`Order is already ${o.status.toLowerCase()}`, 409);
  res.json(await prisma.purchaseOrder.update({ where: { id: o.id }, data: { status: p.data.status } }));
}));

// POST /orders/:id/receive — goods arrived. Adds to stock, records the
// latest purchase cost on the product (feeds margin reports), registers
// serials/IMEIs for tracked products. Partial receipts are allowed.
const receiveSchema = z.object({
  items: z.array(z.object({ itemId: z.number().int().positive(), quantity: qtySchema, serials: z.array(z.string().trim().min(1).max(64)).max(1000).optional() })).min(1),
});
router.post('/orders/:id/receive', wrap(async (req, res) => {
  const p = receiveSchema.safeParse(req.body);
  if (!p.success) throw err('Invalid input');
  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id: idParam(req) }, include: { items: true } });
    if (!order) throw err('Not found', 404);
    if (order.status === 'RECEIVED' || order.status === 'CANCELLED') throw err(`Order is already ${order.status.toLowerCase()}`, 409);
    const byId = new Map(order.items.map((i) => [i.id, i]));
    for (const line of p.data.items) {
      const it = byId.get(line.itemId);
      if (!it) throw err('Item is not on this order', 404);
      if (r3(it.receivedQty + line.quantity) > it.quantity + 1e-9) throw err(`Cannot receive more than ordered for "${it.name}"`, 409);
      const prod = await tx.product.findUnique({ where: { id: it.productId } });
      if (prod.trackSerial) {
        const sers = [...new Set((line.serials || []).map((s) => { const v = validateSerial(s); if (!v.ok) throw err(v.error); return v.serial; }))];
        if (sers.length !== line.quantity) throw err(`"${it.name}" needs ${line.quantity} unique serial/IMEI number(s)`);
        const clash = await tx.serialUnit.findFirst({ where: { serial: { in: sers } } });
        if (clash) throw err(`Serial ${clash.serial} is already registered`, 409);
        for (const serial of sers) {
          const u = await tx.serialUnit.create({ data: { productId: prod.id, serial } });
          await tx.serialEvent.create({ data: { serialId: u.id, type: 'RECEIVED', note: order.number } });
        }
        const count = await tx.serialUnit.count({ where: { productId: prod.id, status: 'IN_STOCK' } });
        await tx.product.update({ where: { id: prod.id }, data: { stock: count, purchasePrice: it.unitCost } });
      } else {
        await tx.product.update({ where: { id: prod.id }, data: { stock: { increment: line.quantity }, purchasePrice: it.unitCost } });
      }
      await tx.purchaseOrderItem.update({ where: { id: it.id }, data: { receivedQty: r3(it.receivedQty + line.quantity) } });
    }
    const fresh = await tx.purchaseOrderItem.findMany({ where: { orderId: order.id } });
    const done = fresh.every((i) => i.receivedQty + 1e-9 >= i.quantity);
    return tx.purchaseOrder.update({ where: { id: order.id }, data: { status: done ? 'RECEIVED' : 'SENT', receivedAt: done ? new Date() : null }, include: { items: true, supplier: true } });
  });
  res.json(updated);
}));

module.exports = router;
