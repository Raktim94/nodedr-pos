const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const checkoutSchema = z.object({
  customerName: z.string().trim().max(200).optional().or(z.literal('')),
  customerPhone: z.string().trim().max(30).optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().positive(),
      })
    )
    .min(1),
});

async function nextInvoiceNumber(tx) {
  const count = await tx.invoice.count();
  const year = new Date().getFullYear();
  return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
}

// POST /api/invoices — finalize checkout: validates stock, decrements it,
// prices items server-side from the product catalog (never trusts client price).
router.post('/', async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const { items, customerName, customerPhone } = parsed.data;

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const productIds = items.map((i) => i.productId);
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map((p) => [p.id, p]));

      let totalAmount = 0;
      const lineItems = [];

      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product) {
          throw Object.assign(new Error(`Product ${item.productId} not found`), { status: 404 });
        }
        if (product.stock < item.quantity) {
          throw Object.assign(
            new Error(`Insufficient stock for "${product.name}" (have ${product.stock}, need ${item.quantity})`),
            { status: 409 }
          );
        }
        const total = Number((product.sellingPrice * item.quantity).toFixed(2));
        totalAmount += total;
        lineItems.push({
          productId: product.id,
          name: product.name,
          quantity: item.quantity,
          price: product.sellingPrice,
          total,
        });
      }
      totalAmount = Number(totalAmount.toFixed(2));

      const invoiceNumber = await nextInvoiceNumber(tx);
      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          customerName: customerName || 'Walk-in Customer',
          customerPhone: customerPhone || null,
          totalAmount,
          items: { create: lineItems },
        },
        include: { items: true },
      });

      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
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

router.get('/', async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(invoices);
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid invoice id' });

  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: true } });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json(invoice);
});

module.exports = router;
