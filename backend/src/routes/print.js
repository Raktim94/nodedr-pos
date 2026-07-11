const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { buildReceiptText } = require('../lib/receipt');
const { printReceipt } = require('../lib/printer');

const router = express.Router();
router.use(requireAuth);

const printSchema = z.object({
  invoiceId: z.coerce.number().int().positive(),
  width: z.coerce.number().int().min(32).max(48).optional(),
});

// POST /api/print — formats the receipt for a saved invoice and sends it to
// the USB thermal printer, including the ESC/POS auto-cut command.
router.post('/', async (req, res) => {
  const parsed = printSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  const [invoice, shop] = await Promise.all([
    prisma.invoice.findUnique({ where: { id: parsed.data.invoiceId }, include: { items: true } }),
    prisma.shopSettings.findFirst(),
  ]);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (!shop) return res.status(400).json({ error: 'Shop settings not configured' });

  const text = buildReceiptText({ shop, invoice, width: parsed.data.width || 48 });

  try {
    const result = await printReceipt(text);
    res.json({ ...result, preview: text });
  } catch (err) {
    console.error('Print failed:', err);
    res.status(502).json({ error: err.message, preview: text });
  }
});

module.exports = router;
