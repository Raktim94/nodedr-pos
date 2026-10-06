const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin, requirePasswordConfirm } = require('../middleware/auth');
const { encrypt, encryptJson, decrypt } = require('../lib/secretBox');
const { round2 } = require('../lib/pricing');
const { dayKey } = require('../lib/reports');
const sync = require('../lib/sync');

// ---- public ingest endpoint (branches push here) ----
const ingest = express.Router();
ingest.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));
ingest.post('/ingest', async (req, res) => {
  const shop = await prisma.shopSettings.findFirst({ select: { syncRole: true } });
  if (shop?.syncRole !== 'hub') return res.status(404).json({ error: 'Not found' });
  const reply = await sync.handleIngest(req.get('x-branch'), req.body?.d);
  if (!reply) return res.status(401).json({ error: 'Rejected' }); // unknown branch / bad secret / stale message
  res.json({ d: reply });
});

// ---- admin / franchisor views ----
const views = express.Router();
views.use(requireAuth);
// Franchisors are read-only (enforced in requireAuth); only admins and
// franchisors may see the consolidated views at all.
views.use((req, res, next) => (['admin', 'franchisor'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Admin or franchisor access required' })));
views.use(async (req, res, next) => {
  const shop = await prisma.shopSettings.findFirst({ select: { syncRole: true } });
  if (shop?.syncRole !== 'hub') return res.status(409).json({ error: 'This instance is not set up as a hub (Settings > Branches)' });
  next();
});

views.get('/branches', async (req, res) => {
  const list = await prisma.branch.findMany({ orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, lastSyncAt: true, createdAt: true } });
  res.json(list);
});

// GET /api/hub/overview — revenue per branch for today / 7 days, and totals.
views.get('/overview', async (req, res) => {
  const branches = await prisma.branch.findMany({ select: { id: true, code: true, name: true, lastSyncAt: true } });
  const today = dayKey(new Date());
  const from = new Date();
  from.setDate(from.getDate() - 6);
  const fromKey = dayKey(from);
  const days = await prisma.branchDay.findMany({ where: { day: { gte: fromKey } } });
  const rows = branches.map((b) => {
    const mine = days.filter((d) => d.branchId === b.id);
    const sum = (list, k) => round2(list.reduce((s, d) => s + d[k], 0));
    const t = mine.filter((d) => d.day === today);
    return { ...b, today: { revenue: sum(t, 'revenue'), bills: sum(t, 'count') }, week: { revenue: sum(mine, 'revenue'), cost: sum(mine, 'cost'), bills: sum(mine, 'count') } };
  });
  const trend = {};
  for (const d of days) trend[d.day] = round2((trend[d.day] || 0) + d.revenue);
  res.json({
    branches: rows,
    totals: { todayRevenue: round2(rows.reduce((s, r) => s + r.today.revenue, 0)), weekRevenue: round2(rows.reduce((s, r) => s + r.week.revenue, 0)) },
    trend: Object.entries(trend).sort().map(([day, revenue]) => ({ day, revenue })),
  });
});

// GET /api/hub/inventory?q= — one row per product with each branch's stock.
views.get('/inventory', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const rows = await prisma.branchStock.findMany({ where: q ? { OR: [{ name: { contains: q } }, { barcode: { contains: q } }] } : undefined, take: 5000, orderBy: { name: 'asc' } });
  const byCode = new Map();
  for (const r of rows) {
    const e = byCode.get(r.barcode) || { barcode: r.barcode, name: r.name, category: r.category, branches: {} };
    e.branches[r.branchId] = r.stock;
    byCode.set(r.barcode, e);
  }
  res.json([...byCode.values()].slice(0, 500));
});

views.get('/transfers', async (req, res) => res.json(await prisma.transfer.findMany({ include: { items: true }, orderBy: { id: 'desc' }, take: 100 })));

// ---- admin only: manage branches + create transfers ----
const adminOnly = [requireAdmin];

const branchSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,20}$/), name: z.string().trim().min(1).max(120) });
views.post('/branches', ...adminOnly, requirePasswordConfirm, async (req, res) => {
  const p = branchSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid input' });
  const secret = crypto.randomBytes(32).toString('base64url');
  try {
    const b = await prisma.branch.create({ data: { ...p.data, secretEnc: encrypt(secret) } });
    // The shared secret is shown ONCE — paste it into the branch's Settings > Sync.
    res.status(201).json({ id: b.id, code: b.code, name: b.name, secret });
  } catch (e) {
    res.status(e.code === 'P2002' ? 409 : 500).json({ error: e.code === 'P2002' ? 'Branch code already exists' : 'Failed' });
  }
});

views.delete('/branches/:id', ...adminOnly, requirePasswordConfirm, async (req, res) => {
  try {
    await prisma.branch.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

const transferSchema = z.object({
  fromBranchId: z.number().int().positive(),
  toBranchId: z.number().int().positive(),
  note: z.string().trim().max(200).optional(),
  items: z.array(z.object({ barcode: z.string().trim().min(1).max(64), quantity: z.number().positive().max(1_000_000) })).min(1).max(200),
});
views.post('/transfers', ...adminOnly, async (req, res) => {
  const p = transferSchema.safeParse(req.body);
  if (!p.success || p.data.fromBranchId === p.data.toBranchId) return res.status(400).json({ error: 'Invalid transfer' });
  const [from, to] = await Promise.all([prisma.branch.findUnique({ where: { id: p.data.fromBranchId } }), prisma.branch.findUnique({ where: { id: p.data.toBranchId } })]);
  if (!from || !to) return res.status(404).json({ error: 'Branch not found' });
  // The source must have the stock as of its last sync.
  const stock = await prisma.branchStock.findMany({ where: { branchId: from.id, barcode: { in: p.data.items.map((i) => i.barcode) } } });
  const have = new Map(stock.map((s) => [s.barcode, s]));
  const items = p.data.items.map((i) => {
    const s = have.get(i.barcode);
    if (!s) throw Object.assign(new Error(`${from.name} has no product ${i.barcode}`), { status: 404 });
    if (s.stock < i.quantity) throw Object.assign(new Error(`${from.name} has only ${s.stock} of "${s.name}"`), { status: 409 });
    return { barcode: i.barcode, name: s.name, quantity: i.quantity };
  });
  const t = await prisma.transfer.create({ data: { fromBranchId: from.id, toBranchId: to.id, note: p.data.note || null, items: { create: items } }, include: { items: true } });
  res.status(201).json(t);
});

views.post('/transfers/:id/cancel', ...adminOnly, async (req, res) => {
  const t = await prisma.transfer.findUnique({ where: { id: Number(req.params.id) } });
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'PENDING') return res.status(409).json({ error: 'Only a transfer that has not shipped can be cancelled' });
  await prisma.transfer.delete({ where: { id: t.id } });
  res.status(204).end();
});

// ---- this instance's own sync role (admin) ----
const cfg = express.Router();
cfg.use(requireAuth, requireAdmin);
cfg.get('/', async (req, res) => {
  const s = await prisma.shopSettings.findFirst();
  res.json({ role: s?.syncRole || 'none', hubUrl: s?.syncHubUrl || '', branchCode: s?.syncBranchCode || '', secretSet: Boolean(s?.syncSecretEnc), lastSyncAt: s?.syncLastAt || null });
});
const cfgSchema = z.object({
  role: z.enum(['none', 'branch', 'hub']),
  hubUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  branchCode: z.string().trim().regex(/^[A-Za-z0-9_-]{2,20}$/).optional().or(z.literal('')),
  secret: z.string().trim().min(16).max(200).optional(),
});
cfg.put('/', requirePasswordConfirm, async (req, res) => {
  const p = cfgSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid input' });
  const s = await prisma.shopSettings.findFirst();
  if (!s) return res.status(404).json({ error: 'No shop settings' });
  if (p.data.role === 'branch') {
    const url = p.data.hubUrl || s.syncHubUrl;
    if (!url) return res.status(400).json({ error: 'Hub URL required' });
    const u = new URL(url);
    const local = ['localhost', '127.0.0.1'].includes(u.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname);
    if (u.protocol !== 'https:' && !local) return res.status(400).json({ error: 'Use an https:// hub URL (plain http is only allowed on a private network)' });
  }
  await prisma.shopSettings.update({
    where: { id: s.id },
    data: {
      syncRole: p.data.role,
      ...(p.data.hubUrl !== undefined ? { syncHubUrl: p.data.hubUrl || null } : {}),
      ...(p.data.branchCode !== undefined ? { syncBranchCode: p.data.branchCode || null } : {}),
      ...(p.data.secret ? { syncSecretEnc: encrypt(p.data.secret) } : {}),
    },
  });
  res.json({ ok: true });
});
cfg.post('/now', async (req, res) => {
  try {
    res.json(await sync.pushToHub());
  } catch (e) {
    res.status(502).json({ error: `Sync failed: ${e.message}` });
  }
});

module.exports = { ingest, views, cfg };
