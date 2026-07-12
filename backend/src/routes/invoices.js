const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { computeSale, round2 } = require('../lib/pricing');

const router = express.Router();
router.use(requireAuth);

const checkoutSchema = z.object({
  customerName: z.string().trim().max(200).optional().or(z.literal('')),
  customerPhone: z.string().trim().max(30).optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  discountType: z.enum(['percent', 'amount']).nullish(),
  discountValue: z.number().min(0).default(0),
  pointsRedeemed: z.number().int().min(0).default(0),
  paymentMethod: z.enum(['CASH', 'UPI', 'CARD']).default('CASH'),
  amountPaid: z.number().min(0).default(0),
});

async function nextInvoiceNumber(tx) {
  const count = await tx.invoice.count();
  const year = new Date().getFullYear();
  return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
}

// POST /api/invoices — finalize a sale. Everything money-related (prices,
// tax, discount caps, loyalty value) is computed server-side from the
// catalog and settings; the client only sends product ids, quantities, and
// intent (discount/points/payment). Fully transactional.
router.post('/', async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const body = parsed.data;

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const settings = await tx.shopSettings.findFirst();
      if (!settings) throw Object.assign(new Error('Shop settings not configured'), { status: 400 });

      const productIds = body.items.map((i) => i.productId);
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map((p) => [p.id, p]));

      const lines = [];
      for (const item of body.items) {
        const product = productMap.get(item.productId);
        if (!product) throw Object.assign(new Error(`Product ${item.productId} not found`), { status: 404 });
        if (product.stock < item.quantity) {
          throw Object.assign(
            new Error(`Insufficient stock for "${product.name}" (have ${product.stock}, need ${item.quantity})`),
            { status: 409 }
          );
        }
        lines.push({ product, quantity: item.quantity });
      }

      // Resolve customer (needed for loyalty). Match by phone; create if new
      // and a name was given. Cap redeemable points at the customer's balance.
      let customer = null;
      if (body.customerPhone) {
        customer = await tx.customer.findUnique({ where: { phone: body.customerPhone } });
        if (!customer && body.customerName) {
          customer = await tx.customer.create({
            data: { name: body.customerName, phone: body.customerPhone },
          });
        }
      }

      let pointsRedeemed = body.pointsRedeemed;
      if (!settings.loyaltyEnabled || !customer) pointsRedeemed = 0;
      if (customer && pointsRedeemed > customer.loyaltyPoints) pointsRedeemed = customer.loyaltyPoints;

      const computed = computeSale(lines, {
        discountType: body.discountType || null,
        discountValue: body.discountValue,
        pointsRedeemed,
        settings,
      });

      const amountPaid = body.paymentMethod === 'CASH' ? body.amountPaid : computed.totalAmount;
      const changeDue = round2(Math.max(0, amountPaid - computed.totalAmount));

      const invoiceNumber = await nextInvoiceNumber(tx);
      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: customer?.id ?? null,
          customerName: body.customerName || customer?.name || 'Walk-in Customer',
          customerPhone: body.customerPhone || null,
          subtotal: computed.subtotal,
          discountType: computed.discountType,
          discountValue: computed.discountValue,
          discountAmount: computed.discountAmount,
          taxAmount: computed.taxAmount,
          loyaltyDiscount: computed.loyaltyDiscount,
          totalAmount: computed.totalAmount,
          paymentMethod: body.paymentMethod,
          amountPaid,
          changeDue,
          pointsRedeemed: computed.pointsRedeemed,
          pointsEarned: computed.pointsEarned,
          items: { create: computed.items },
        },
        include: { items: true },
      });

      for (const item of body.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      if (customer) {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            loyaltyPoints: { increment: computed.pointsEarned - computed.pointsRedeemed },
            totalSpent: { increment: computed.totalAmount },
            visits: { increment: 1 },
          },
        });
      }

      return created;
    });

    res.status(201).json(invoice);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Checkout failed' });
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
      take: 5,
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
    trendMap.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10), revenue: 0, count: 0 });
  }
  for (const inv of recent) {
    const key = new Date(inv.createdAt).toISOString().slice(0, 10);
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

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid invoice id' });
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: true } });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json(invoice);
});

module.exports = router;
