const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const settingsSchema = z.object({
  shopName: z.string().trim().min(1).max(120),
  address1: z.string().trim().min(1).max(200),
  address2: z.string().trim().max(200).optional().or(z.literal('')),
  currency: z.string().trim().min(1).max(10).default('Rs.'),
  lowStockAlert: z.coerce.number().int().min(0).max(100000).default(5),
});

// GET /api/settings — public read (receipt/dashboard need it before login in some flows)
router.get('/', async (req, res) => {
  const settings = await prisma.shopSettings.findFirst();
  res.json(settings || null);
});

// POST /api/settings — onboarding Step 2, only once (until settings exist, then requires auth to change)
router.post('/', async (req, res) => {
  const existing = await prisma.shopSettings.findFirst();
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  if (existing) {
    return res.status(403).json({ error: 'Shop settings already configured, use PUT /api/settings' });
  }

  const created = await prisma.shopSettings.create({ data: parsed.data });
  res.status(201).json(created);
});

router.put('/', requireAuth, async (req, res) => {
  const existing = await prisma.shopSettings.findFirst();
  if (!existing) return res.status(404).json({ error: 'No shop settings to update' });

  const parsed = settingsSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  const updated = await prisma.shopSettings.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(updated);
});

module.exports = router;
