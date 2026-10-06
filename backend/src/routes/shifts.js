const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, hasPerm } = require('../middleware/auth');
const { round2 } = require('../lib/pricing');

const router = express.Router();
router.use(requireAuth);

// Cash that should physically be in the drawer for a shift: opening float,
// plus cash taken on cash bills (net of what was applied from the old due),
// minus cash paid out as refunds, plus/minus manual pay-in / pay-out.
async function shiftTotals(shift) {
  const invoices = await prisma.invoice.findMany({
    where: { shiftId: shift.id },
    select: { paymentMethod: true, amountPaid: true, previousDuePaid: true, refundValue: true, refundMode: true, totalAmount: true },
  });
  let cashSales = 0;
  let cashRefunds = 0;
  const byMethod = {};
  for (const i of invoices) {
    byMethod[i.paymentMethod] = round2((byMethod[i.paymentMethod] || 0) + i.totalAmount);
    if (i.paymentMethod === 'CASH') cashSales += i.amountPaid + i.previousDuePaid;
    if (i.refundMode === 'CASH') cashRefunds += i.refundValue;
  }
  const movements = await prisma.shiftMovement.findMany({ where: { shiftId: shift.id }, orderBy: { id: 'asc' } });
  const cashIn = movements.filter((m) => m.type === 'IN').reduce((s, m) => s + m.amount, 0);
  const cashOut = movements.filter((m) => m.type === 'OUT').reduce((s, m) => s + m.amount, 0);
  const expectedCash = round2(shift.openingFloat + cashSales - cashRefunds + cashIn - cashOut);
  return {
    bills: invoices.length,
    salesByMethod: byMethod,
    cashSales: round2(cashSales),
    cashRefunds: round2(cashRefunds),
    cashIn: round2(cashIn),
    cashOut: round2(cashOut),
    expectedCash,
    movements,
  };
}

// GET /api/shifts/current — this user's open shift with live drawer totals.
router.get('/current', async (req, res) => {
  const shift = await prisma.shift.findFirst({ where: { userId: req.user.id, closedAt: null } });
  if (!shift) return res.json(null);
  res.json({ ...shift, ...(await shiftTotals(shift)) });
});

router.post('/open', async (req, res) => {
  const parsed = z.object({ openingFloat: z.number().min(0).max(10_000_000).default(0) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid opening float' });
  const open = await prisma.shift.findFirst({ where: { userId: req.user.id, closedAt: null } });
  if (open) return res.status(409).json({ error: 'You already have an open shift — close it first' });
  const shift = await prisma.shift.create({
    data: { userId: req.user.id, userName: req.user.name, openingFloat: parsed.data.openingFloat },
  });
  res.status(201).json(shift);
});

router.post('/movement', async (req, res) => {
  const parsed = z
    .object({ type: z.enum(['IN', 'OUT']), amount: z.number().positive().max(10_000_000), note: z.string().trim().max(200).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const shift = await prisma.shift.findFirst({ where: { userId: req.user.id, closedAt: null } });
  if (!shift) return res.status(409).json({ error: 'Open a shift first' });
  const m = await prisma.shiftMovement.create({ data: { shiftId: shift.id, ...parsed.data } });
  res.status(201).json(m);
});

// POST /api/shifts/close — count the drawer; variance = counted − expected.
router.post('/close', async (req, res) => {
  const parsed = z
    .object({ closingCounted: z.number().min(0).max(100_000_000), note: z.string().trim().max(300).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the counted cash' });
  const shift = await prisma.shift.findFirst({ where: { userId: req.user.id, closedAt: null } });
  if (!shift) return res.status(409).json({ error: 'No open shift' });
  const totals = await shiftTotals(shift);
  const closed = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      closedAt: new Date(),
      closingCounted: parsed.data.closingCounted,
      expectedCash: totals.expectedCash,
      variance: round2(parsed.data.closingCounted - totals.expectedCash),
      note: parsed.data.note || null,
    },
  });
  res.json({ ...closed, ...totals });
});

// GET /api/shifts — recent shifts (own, or everyone's with the reports right).
router.get('/', async (req, res) => {
  const all = hasPerm(req.user, 'reports');
  const shifts = await prisma.shift.findMany({
    where: all ? undefined : { userId: req.user.id },
    orderBy: { openedAt: 'desc' },
    take: Math.min(Number(req.query.limit) || 50, 200),
  });
  res.json(shifts);
});

module.exports = router;
