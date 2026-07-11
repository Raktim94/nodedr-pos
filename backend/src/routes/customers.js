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
