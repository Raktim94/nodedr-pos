const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { verifyReceiptToken, verifyPortalToken, receiptUrl } = require('../lib/publicLink');
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

// ---- customer portal (PWA) ----------------------------------------------

// GET /api/public/customer/:token — loyalty, dues, recent receipts and shop
// announcements for one customer. The signed link IS the credential, so it is
// only ever shared with that customer (e.g. over WhatsApp).
router.get('/customer/:token', async (req, res) => {
  const id = verifyPortalToken(req.params.token);
  if (!id) return res.status(404).json({ error: 'Not found' });
  const [customer, shop, announcements, invoices] = await Promise.all([
    prisma.customer.findUnique({ where: { id } }),
    prisma.shopSettings.findFirst({ select: { shopName: true, currencySymbol: true, loyaltyEnabled: true, phone: true } }),
    prisma.announcement.findMany({ where: { active: true }, orderBy: { id: 'desc' }, take: 10, select: { title: true, body: true, createdAt: true } }),
    prisma.invoice.findMany({ where: { customerId: id }, orderBy: { id: 'desc' }, take: 20, select: { id: true, invoiceNumber: true, totalAmount: true, createdAt: true } }),
  ]);
  if (!customer || !shop) return res.status(404).json({ error: 'Not found' });
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({
    shop,
    customer: { name: customer.name, loyaltyPoints: customer.loyaltyPoints, totalDue: customer.totalDue, creditBalance: customer.creditBalance, visits: customer.visits },
    announcements,
    receipts: invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, totalAmount: i.totalAmount, createdAt: i.createdAt, url: receiptUrl(base, i.id) })),
  });
});

module.exports = router;
