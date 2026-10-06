const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { verifyReceiptToken } = require('../lib/publicLink');
const { buildInvoicePdf } = require('../lib/pdfInvoice');
const { buildReceiptPdf } = require('../lib/pdf');

const router = express.Router();

router.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

// GET /api/public/receipt/:token — the PDF behind a signed share link.
// Unauthenticated by design (a customer opens it from WhatsApp); the HMAC
// token is the credential. Same 404 for bad, expired or unknown tokens.
router.get('/receipt/:token', async (req, res) => {
  const id = verifyReceiptToken(req.params.token);
  if (!id) return res.status(404).json({ error: 'Not found' });
  const [invoice, shop] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      include: { items: { include: { serials: { select: { serial: true, warrantyEndsAt: true } }, product: { select: { hsn: true } } } } },
    }),
    prisma.shopSettings.findFirst(),
  ]);
  if (!invoice || !shop) return res.status(404).json({ error: 'Not found' });
  const pdf = shop.invoiceLayout === 'a4' ? await buildInvoicePdf({ shop, invoice }) : await buildReceiptPdf({ shop, invoice });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${invoice.invoiceNumber}.pdf"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=300',
  });
  res.send(pdf);
});

module.exports = router;
