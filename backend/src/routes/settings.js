const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { CURRENCIES, symbolFor } = require('../lib/currency');

const router = express.Router();

const settingsSchema = z.object({
  shopName: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(160).optional().or(z.literal('')),
  address1: z.string().trim().min(1).max(200),
  address2: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  pincode: z.string().trim().max(10).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().max(200).optional().or(z.literal('')),
  currencyCode: z.enum(Object.keys(CURRENCIES)).default('INR'),
  gstEnabled: z.boolean().default(false),
  gstNumber: z.string().trim().max(20).optional().or(z.literal('')),
  panNumber: z.string().trim().max(10).optional().or(z.literal('')),
  defaultTaxRate: z.number().min(0).max(100).default(0),
  loyaltyEnabled: z.boolean().default(false),
  pointsPerUnit: z.number().min(0).max(1000).default(0),
  pointValue: z.number().min(0).max(10000).default(0),
  receiptHeader: z.string().trim().max(200).optional().or(z.literal('')),
  receiptFooter: z.string().trim().max(200).default('Thank You! Visit Again.'),
  showGst: z.boolean().default(true),
  lowStockAlert: z.number().int().min(0).max(100000).default(5),
});

// Derive the currency symbol from the code so the two never drift apart.
function withSymbol(data) {
  return { ...data, currencySymbol: symbolFor(data.currencyCode) };
}

// GET /api/settings/currencies — currency options for the settings UI
router.get('/currencies', (req, res) => {
  res.json(CURRENCIES);
});

// GET /api/settings — public read (receipt/branding needed before login)
router.get('/', async (req, res) => {
  const settings = await prisma.shopSettings.findFirst();
  res.json(settings || null);
});

// POST /api/settings — onboarding step 2, only once
router.post('/', async (req, res) => {
  const existing = await prisma.shopSettings.findFirst();
  if (existing) {
    return res.status(403).json({ error: 'Shop settings already configured; use PUT /api/settings' });
  }
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const created = await prisma.shopSettings.create({ data: withSymbol(parsed.data) });
  res.status(201).json(created);
});

// PUT /api/settings — admins edit company/currency/tax/loyalty/receipt config
router.put('/', requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.shopSettings.findFirst();
  if (!existing) return res.status(404).json({ error: 'No shop settings to update' });

  const parsed = settingsSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const data = { ...parsed.data };
  if (data.currencyCode) data.currencySymbol = symbolFor(data.currencyCode);

  const updated = await prisma.shopSettings.update({ where: { id: existing.id }, data });
  res.json(updated);
});

module.exports = router;
