const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const productSchema = z.object({
  barcode: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  purchasePrice: z.coerce.number().min(0),
  sellingPrice: z.coerce.number().min(0),
  stock: z.coerce.number().int().min(0).default(0),
});

// GET /api/products?q=search — list/search
router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const products = await prisma.product.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q } },
            { barcode: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { name: 'asc' },
  });
  res.json(products);
});

// GET /api/products/low-stock — dashboard widget
router.get('/low-stock', async (req, res) => {
  const settings = await prisma.shopSettings.findFirst();
  const threshold = settings?.lowStockAlert ?? 5;
  const products = await prisma.product.findMany({
    where: { stock: { lte: threshold } },
    orderBy: { stock: 'asc' },
  });
  res.json({ threshold, products });
});

// GET /api/products/barcode/:barcode — scanner lookup (POS + Inventory scan flow)
router.get('/barcode/:barcode', async (req, res) => {
  const product = await prisma.product.findUnique({ where: { barcode: req.params.barcode } });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

router.post('/', async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  const existing = await prisma.product.findUnique({ where: { barcode: parsed.data.barcode } });
  if (existing) return res.status(409).json({ error: 'Barcode already exists', product: existing });

  const product = await prisma.product.create({ data: parsed.data });
  res.status(201).json(product);
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid product id' });

  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  try {
    const product = await prisma.product.update({ where: { id }, data: parsed.data });
    res.json(product);
  } catch {
    res.status(404).json({ error: 'Product not found' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid product id' });

  try {
    await prisma.product.delete({ where: { id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Product not found' });
  }
});

module.exports = router;
