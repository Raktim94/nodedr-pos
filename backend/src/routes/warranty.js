const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalizeSerial, warrantyStatus } = require('../lib/serials');
const { lookupWarranty } = require('../lib/warranty');

const router = express.Router();
router.use(requireAuth);

// GET /api/warranty/:serial — everything about one unit from a scanned
// IMEI / serial number: product, who bought it and when, warranty window,
// and its full history.
router.get('/:serial', async (req, res) => {
  const result = await lookupWarranty(req.params.serial);
  if (!result) return res.status(404).json({ error: 'No unit with that serial/IMEI' });
  res.json(result);
});

// POST /api/warranty/:serial/claim — log a warranty claim against a unit.
router.post('/:serial/claim', async (req, res) => {
  const parsed = z.object({ note: z.string().trim().min(1).max(300) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Describe the issue (note required)' });
  const unit = await prisma.serialUnit.findUnique({ where: { serial: normalizeSerial(req.params.serial) } });
  if (!unit) return res.status(404).json({ error: 'No unit with that serial/IMEI' });
  if (unit.status !== 'SOLD') return res.status(409).json({ error: 'Only a sold unit can have a warranty claim' });
  const status = warrantyStatus(unit);
  const event = await prisma.serialEvent.create({
    data: { serialId: unit.id, type: 'CLAIM', note: `[${status}] ${parsed.data.note}` },
  });
  res.status(201).json(event);
});

// GET /api/warranty?phone= — all serial units a customer has bought.
router.get('/', async (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  const units = await prisma.serialUnit.findMany({
    where: { invoiceItem: { invoice: { customerPhone: phone } } },
    include: { product: { select: { name: true } }, invoiceItem: { select: { invoice: { select: { invoiceNumber: true } } } } },
    orderBy: { soldAt: 'desc' },
    take: 200,
  });
  res.json(
    units.map((u) => ({
      serial: u.serial,
      product: u.product.name,
      invoiceNumber: u.invoiceItem?.invoice.invoiceNumber,
      soldAt: u.soldAt,
      warrantyEndsAt: u.warrantyEndsAt,
      warranty: warrantyStatus(u),
    }))
  );
});

module.exports = router;
