const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { z } = require('zod');
const { verifyReceiptToken, verifyPortalToken, receiptUrl } = require('../lib/publicLink');
const orders = require('../lib/orders');
const { effectivePrice } = require('../lib/pricing');
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

// ---- QR menu / click-and-collect (customer-facing, no login) -------------

const orderLimiter = rateLimit({ windowMs: 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many orders — please wait a moment.' } });
const MAX_OPEN_PUBLIC_ORDERS = 200; // cap on spam: reservations can't be filled without bound

// GET /api/public/menu — only products the owner flagged "show in menu".
router.get('/menu', async (req, res) => {
  const [shop, products, reserved] = await Promise.all([
    prisma.shopSettings.findFirst({ select: { shopName: true, currencySymbol: true } }),
    prisma.product.findMany({ where: { showInMenu: true, trackSerial: false }, orderBy: [{ category: 'asc' }, { name: 'asc' }], take: 500 }),
    prisma.orderItem.groupBy({ by: ['productId'], where: { order: { status: { in: orders.OPEN } } }, _sum: { quantity: true } }),
  ]);
  const held = new Map(reserved.map((r) => [r.productId, r._sum.quantity || 0]));
  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    shop,
    items: products
      .map((p) => ({ id: p.id, name: p.name, category: p.category || 'Other', unit: p.unit, price: effectivePrice(p), available: Math.max(0, p.stock - (held.get(p.id) || 0)) }))
      .filter((p) => p.available > 0),
  });
});

const menuOrderSchema = z.object({
  tableNo: z.string().trim().max(20).optional(),
  fulfilment: z.enum(['DINE_IN', 'PICKUP']).default('PICKUP'),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).optional(),
  note: z.string().trim().max(200).optional(),
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(50) })).min(1).max(30),
});

// POST /api/public/menu/order — prices come from the catalog; the client
// only says which items and how many.
router.post('/menu/order', orderLimiter, async (req, res) => {
  const p = menuOrderSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid order' });
  try {
    if ((await prisma.order.count({ where: { channel: 'QR_MENU', status: { in: orders.OPEN } } })) >= MAX_OPEN_PUBLIC_ORDERS) {
      return res.status(503).json({ error: 'Ordering is busy right now — please ask at the counter.' });
    }
    const allowed = await prisma.product.findMany({ where: { id: { in: p.data.items.map((i) => i.productId) }, showInMenu: true, trackSerial: false }, select: { id: true } });
    if (allowed.length !== new Set(p.data.items.map((i) => i.productId)).size) return res.status(400).json({ error: 'Some items are not on the menu' });
    const { order } = await orders.createOrder({
      channel: 'QR_MENU',
      fulfilment: p.data.fulfilment,
      tableNo: p.data.tableNo,
      customer: { name: p.data.name, phone: p.data.phone },
      items: p.data.items,
      note: p.data.note,
    });
    res.status(201).json({ id: order.id, pickupCode: order.pickupCode, total: order.total, status: order.status });
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not place the order' });
  }
});

// GET /api/public/order/:id?code= — order status for the customer's phone.
// The pickup code is the credential; same 404 for wrong id or wrong code.
router.get('/order/:id', async (req, res) => {
  const id = Number(req.params.id);
  const code = String(req.query.code || '').toUpperCase();
  const o = Number.isInteger(id) && code ? await prisma.order.findFirst({ where: { id, pickupCode: code }, include: { items: true } }) : null;
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json({ id: o.id, status: o.status, total: o.total, fulfilment: o.fulfilment, tableNo: o.tableNo, items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })) });
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
