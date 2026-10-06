const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, verifyPassword, hasPerm } = require('../middleware/auth');
const { round2 } = require('../lib/pricing');
const { checkoutSchema, performCheckout } = require('../lib/checkout');

const router = express.Router();
router.use(requireAuth);

// POST /api/invoices — finalize a sale (see lib/checkout.js: everything
// money-related is computed server-side; fully transactional).
router.post('/', async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const body = parsed.data;

  // Step-up re-auth: only a bill that actually returns/refunds something
  // needs the password re-confirmed — the overwhelming majority of
  // checkouts are plain sales and must not be interrupted by this.
  if (body.returns.length > 0) {
    if (!hasPerm(req.user, 'returns')) return res.status(403).json({ error: "You don't have permission to process returns", code: 'PERMISSION_DENIED' });
    const ok = await verifyPassword(req.user.id, req.body?.confirmPassword);
    if (!ok) {
      return res.status(401).json({ error: 'Confirm your password to process this refund', code: 'PASSWORD_CONFIRM_REQUIRED' });
    }
  }

  try {
    const { invoice } = await performCheckout(body, { source: 'POS', cashierName: req.user.name, user: req.user });
    res.status(201).json(invoice);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Checkout failed', ...(err.code && typeof err.code === 'string' && err.code.includes('_') ? { code: err.code } : {}) });
  }
});

// GET /api/invoices?q=&from=&to=
router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const where = q
    ? { OR: [{ invoiceNumber: { contains: q } }, { customerName: { contains: q } }, { customerPhone: { contains: q } }] }
    : undefined;
  const invoices = await prisma.invoice.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });
  res.json(invoices);
});

// GET /api/invoices/summary — dashboard totals for today
router.get('/summary', async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [todays, all] = await Promise.all([
    prisma.invoice.findMany({ where: { createdAt: { gte: start } } }),
    prisma.invoice.aggregate({ _sum: { totalAmount: true }, _count: true }),
  ]);
  const todaysRevenue = round2(todays.reduce((s, i) => s + i.totalAmount, 0));
  res.json({
    todaysCount: todays.length,
    todaysRevenue,
    totalSales: all._count,
    totalRevenue: round2(all._sum.totalAmount || 0),
  });
});

// Calendar-day key in the server's local timezone. Using toISOString().slice(0, 10)
// here would convert to UTC first — in any timezone ahead of UTC (e.g. IST,
// UTC+5:30) that silently shifts "today" back a day, so a bucket built from
// local midnight and a bucket looked up from an invoice's own timestamp would
// key to DIFFERENT dates and every invoice would land outside the whole
// window (see git history for the bug this replaced: every invoice missed
// every bucket, so the trend chart always showed "not enough sales").
function localDateKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// GET /api/invoices/analytics — feeds the dashboard charts: revenue trend
// over the last 14 days, top-selling products, and payment method mix.
router.get('/analytics', async (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 13);
  since.setHours(0, 0, 0, 0);

  const [recent, topItems, byMethod] = await Promise.all([
    prisma.invoice.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, totalAmount: true, paymentMethod: true },
    }),
    prisma.invoiceItem.groupBy({
      by: ['productId', 'name'],
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    }),
    prisma.invoice.groupBy({
      by: ['paymentMethod'],
      _sum: { totalAmount: true },
      _count: true,
    }),
  ]);

  const trendMap = new Map();
  for (let i = 0; i < 14; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = localDateKey(d);
    trendMap.set(key, { date: key, revenue: 0, count: 0 });
  }
  for (const inv of recent) {
    const key = localDateKey(inv.createdAt);
    const bucket = trendMap.get(key);
    if (bucket) {
      bucket.revenue = round2(bucket.revenue + inv.totalAmount);
      bucket.count += 1;
    }
  }

  res.json({
    trend: Array.from(trendMap.values()),
    topProducts: topItems.map((t) => ({
      name: t.name,
      quantity: t._sum.quantity || 0,
      revenue: round2(t._sum.total || 0),
    })),
    paymentMethods: byMethod.map((m) => ({
      method: m.paymentMethod,
      count: m._count,
      revenue: round2(m._sum.totalAmount || 0),
    })),
  });
});

// Minimal CSV cell escaping: wrap in quotes and double up any embedded
// quotes if the value contains a comma, quote, or newline.
function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/invoices/export.csv?from=&to= — one row per invoice. Defaults to
// all invoices; from/to (ISO dates) narrow the range for a period report.
router.get('/export.csv', async (req, res) => {
  const where = {};
  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.gte = new Date(req.query.from);
    if (req.query.to) where.createdAt.lte = new Date(req.query.to);
  }
  const invoices = await prisma.invoice.findMany({ where, orderBy: { createdAt: 'desc' } });

  const header = [
    'Invoice Number',
    'Date',
    'Customer',
    'Phone',
    'Payment Method',
    'Subtotal',
    'Discount',
    'Tax',
    'Loyalty Discount',
    'Total',
    'Amount Paid',
    'Change Due',
  ];
  const rows = invoices.map((inv) => [
    inv.invoiceNumber,
    new Date(inv.createdAt).toISOString(),
    inv.customerName,
    inv.customerPhone || '',
    inv.paymentMethod,
    inv.subtotal,
    inv.discountAmount,
    inv.taxAmount,
    inv.loyaltyDiscount,
    inv.totalAmount,
    inv.amountPaid,
    inv.changeDue,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sales-export-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid invoice id' });
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: true } });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json(invoice);
});

module.exports = router;
