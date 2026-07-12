const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const customerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(3).max(30),
  email: z.string().trim().max(200).optional().or(z.literal('')),
});

// GET /api/customers?q=search
router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const customers = await prisma.customer.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json(customers);
});

// GET /api/customers/top-loyalty?limit=5 — dashboard widget, ranked by
// current loyalty point balance (not lifetime points earned, since redeemed
// points are already subtracted — this reflects what a customer could
// redeem right now).
router.get('/top-loyalty', async (req, res) => {
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
  const customers = await prisma.customer.findMany({
    where: { loyaltyPoints: { gt: 0 } },
    orderBy: { loyaltyPoints: 'desc' },
    take: limit,
  });
  res.json(customers);
});

// GET /api/customers/phone/:phone — POS lookup for loyalty
router.get('/phone/:phone', async (req, res) => {
  const customer = await prisma.customer.findUnique({ where: { phone: req.params.phone } });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer);
});

router.post('/', async (req, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const existing = await prisma.customer.findUnique({ where: { phone: parsed.data.phone } });
  if (existing) return res.status(409).json({ error: 'A customer with that phone already exists', customer: existing });

  const customer = await prisma.customer.create({ data: parsed.data });
  res.status(201).json(customer);
});

const settleDueSchema = z.object({
  amount: z.number().positive(),
  note: z.string().trim().max(200).optional().or(z.literal('')),
});

// POST /api/customers/:id/settle-due — record a payment against a
// customer's running due balance ("udhaar"). Kept as its own audit trail
// (CustomerDuePayment) rather than just decrementing a number with no
// history. Amount is capped at the current balance — can't "overpay" a due
// into a negative number by mistake.
router.post('/:id/settle-due', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer id' });
  const parsed = settleDueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findUnique({ where: { id } });
      if (!existing) throw Object.assign(new Error('Customer not found'), { status: 404 });

      const amount = Math.min(parsed.data.amount, existing.totalDue);
      if (amount <= 0) throw Object.assign(new Error('This customer has no outstanding due'), { status: 400 });

      await tx.customerDuePayment.create({
        data: { customerId: id, amount, note: parsed.data.note || null },
      });
      return tx.customer.update({ where: { id }, data: { totalDue: { decrement: amount } } });
    });
    res.json(customer);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Could not record payment' });
  }
});

// GET /api/customers/:id/due-payments — settlement history for a customer
router.get('/:id/due-payments', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer id' });
  const payments = await prisma.customerDuePayment.findMany({
    where: { customerId: id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(payments);
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer id' });
  const parsed = customerSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  try {
    const customer = await prisma.customer.update({ where: { id }, data: parsed.data });
    res.json(customer);
  } catch {
    res.status(404).json({ error: 'Customer not found' });
  }
});

module.exports = router;
