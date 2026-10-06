const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const schema = z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(600), active: z.boolean().default(true) });

router.get('/', async (req, res) => res.json(await prisma.announcement.findMany({ orderBy: { id: 'desc' }, take: 100 })));
router.post('/', async (req, res) => {
  const p = schema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid input' });
  res.status(201).json(await prisma.announcement.create({ data: p.data }));
});
router.put('/:id', async (req, res) => {
  const p = schema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid input' });
  try {
    res.json(await prisma.announcement.update({ where: { id: Number(req.params.id) }, data: p.data }));
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});
router.delete('/:id', async (req, res) => {
  try {
    await prisma.announcement.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

module.exports = router;
