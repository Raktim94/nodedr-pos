const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requirePerm } = require('../middleware/auth');
const orders = require('../lib/orders');

const router = express.Router();
router.use(requireAuth, requirePerm('orders'));

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Invalid input' });
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Request failed' });
  }
};
const idOf = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return id;
};

// GET /api/orders?status=NEW,PACKING,READY (default: all open) — the board.
router.get('/', wrap(async (req, res) => {
  const wanted = String(req.query.status || 'NEW,PACKING,READY').split(',').filter((s) => ['NEW', 'PACKING', 'READY', 'COLLECTED', 'CANCELLED'].includes(s));
  const list = await prisma.order.findMany({
    where: { status: { in: wanted } },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(req.query.limit) || 200, 500),
  });
  res.json(list.map(orders.publicOrder));
}));

// GET /api/orders/by-code/:code — pickup-code scan / lookup.
router.get('/by-code/:code', wrap(async (req, res) => {
  const o = await prisma.order.findFirst({ where: { pickupCode: String(req.params.code).toUpperCase(), status: { in: orders.OPEN } }, include: { items: true } });
  if (!o) return res.status(404).json({ error: 'No open order with that pickup code' });
  res.json(orders.publicOrder(o));
}));

router.patch('/:id/status', wrap(async (req, res) => {
  const { status } = z.object({ status: z.enum(['PACKING', 'READY', 'CANCELLED']) }).parse(req.body);
  res.json(orders.publicOrder(await orders.setStatus(idOf(req), status)));
}));

// POST /api/orders/:id/collect — hand over. Billing follows who took the money:
// `bill` omitted => bill in the POS only if the website has NOT been paid yet;
// pass bill:true/false to override. Returns { order, invoice? }.
router.post('/:id/collect', wrap(async (req, res) => {
  const p = z.object({
    bill: z.boolean().optional(),
    paymentMethod: z.enum(['CASH', 'UPI', 'CARD']).default('CASH'),
    amountPaid: z.number().min(0).default(0),
    serials: z.record(z.string(), z.array(z.string().trim().min(1).max(64)).max(1000)).default({}),
  }).parse(req.body ?? {});
  const { order, invoice } = await orders.collect(idOf(req), { ...p, user: req.user });
  res.json({ order: orders.publicOrder(order), ...(invoice ? { invoice } : {}) });
}));

module.exports = router;
