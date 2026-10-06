// Optional, self-hosted branch <-> hub sync. Nothing leaves the owner's own
// machines: a *hub* instance (the owner's server or VPS) consolidates reports
// and stock from *branch* instances and coordinates stock transfers. Branches
// push on a timer; every message is AES-256-GCM encrypted with a per-branch
// shared secret (authenticated, so tampering is detected) and carries a
// timestamp so a captured message can't be replayed later.
const crypto = require('crypto');
const prisma = require('./prisma');
const { decrypt } = require('./secretBox');
const { round2 } = require('./pricing');
const { dayKey } = require('./reports');

const MAX_SKEW_MS = 10 * 60 * 1000;

const keyFor = (secret) => crypto.createHash('sha256').update(`nodedr-sync-v1:${secret}`).digest();

function seal(secret, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function open(secret, blob) {
  try {
    const buf = Buffer.from(String(blob), 'base64');
    if (buf.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', keyFor(secret), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

// ---------------- branch side ----------------

async function buildSnapshot(shop) {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  since.setHours(0, 0, 0, 0);
  const [products, invoices, costs] = await Promise.all([
    prisma.product.findMany({ select: { barcode: true, name: true, category: true, stock: true, sellingPrice: true } }),
    prisma.invoice.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, totalAmount: true, taxAmount: true } }),
    prisma.$queryRaw`SELECT i.createdAt AS at, ii.costPrice * ii.quantity AS cost FROM InvoiceItem ii JOIN Invoice i ON i.id = ii.invoiceId WHERE i.createdAt >= ${since}`,
  ]);
  const days = new Map();
  const slot = (d) => {
    const k = dayKey(d);
    if (!days.has(k)) days.set(k, { day: k, revenue: 0, tax: 0, cost: 0, count: 0 });
    return days.get(k);
  };
  for (const i of invoices) {
    const s = slot(i.createdAt);
    s.revenue = round2(s.revenue + i.totalAmount);
    s.tax = round2(s.tax + i.taxAmount);
    s.count += 1;
  }
  for (const c of costs) {
    const s = slot(c.at);
    s.cost = round2(s.cost + Number(c.cost));
  }
  return { stock: products.map((p) => ({ barcode: p.barcode, name: p.name, category: p.category, stock: p.stock, price: p.sellingPrice })), days: [...days.values()] };
}

async function applyTransfers(transfers) {
  const acks = [];
  for (const t of transfers) {
    const already = await prisma.appliedTransfer.findUnique({ where: { transferId: t.id } });
    if (already && already.status === t.status) {
      acks.push({ id: t.id, status: t.status });
      continue;
    }
    await prisma.$transaction(async (tx) => {
      for (const it of t.items) {
        const p = await tx.product.findUnique({ where: { barcode: it.barcode } });
        if (!p || p.trackSerial) continue; // serial-tracked stock moves only via its units
        await tx.product.update({ where: { id: p.id }, data: { stock: t.direction === 'OUT' ? Math.max(0, p.stock - it.quantity) : p.stock + it.quantity } });
      }
      await tx.appliedTransfer.upsert({ where: { transferId: t.id }, create: { transferId: t.id, status: t.status }, update: { status: t.status } });
    });
    acks.push({ id: t.id, status: t.status });
  }
  return acks;
}

let pendingAcks = [];

async function pushToHub() {
  const shop = await prisma.shopSettings.findFirst();
  if (!shop || shop.syncRole !== 'branch' || !shop.syncHubUrl || !shop.syncBranchCode) return { skipped: true };
  const secret = decrypt(shop.syncSecretEnc);
  if (!secret) throw new Error('Sync secret is missing or unreadable');
  const snapshot = await buildSnapshot(shop);
  const body = seal(secret, { ts: Date.now(), ...snapshot, acks: pendingAcks });
  const res = await fetch(`${shop.syncHubUrl.replace(/\/$/, '')}/api/hub/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Branch': shop.syncBranchCode },
    body: JSON.stringify({ d: body }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`hub responded ${res.status}`);
  const reply = open(secret, (await res.json()).d);
  if (!reply) throw new Error('hub reply could not be decrypted (wrong secret?)');
  pendingAcks = [];
  if (reply.transfers?.length) pendingAcks = await applyTransfers(reply.transfers);
  await prisma.shopSettings.update({ where: { id: shop.id }, data: { syncLastAt: new Date() } });
  return { pushed: snapshot.stock.length, transfers: reply.transfers?.length || 0 };
}

// ---------------- hub side ----------------

async function handleIngest(branchCode, blob) {
  const branch = await prisma.branch.findUnique({ where: { code: String(branchCode) } });
  if (!branch) return null;
  const secret = decrypt(branch.secretEnc);
  const msg = secret && open(secret, blob);
  if (!msg || Math.abs(Date.now() - Number(msg.ts)) > MAX_SKEW_MS) return null;

  await prisma.$transaction(async (tx) => {
    await tx.branchStock.deleteMany({ where: { branchId: branch.id } });
    for (const s of (msg.stock || []).slice(0, 50000)) {
      await tx.branchStock.create({ data: { branchId: branch.id, barcode: String(s.barcode).slice(0, 64), name: String(s.name).slice(0, 200), category: s.category ? String(s.category).slice(0, 80) : null, stock: Number(s.stock) || 0, price: Number(s.price) || 0 } });
    }
    for (const d of (msg.days || []).slice(0, 14)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day)) continue;
      await tx.branchDay.upsert({
        where: { branchId_day: { branchId: branch.id, day: d.day } },
        create: { branchId: branch.id, day: d.day, revenue: Number(d.revenue) || 0, tax: Number(d.tax) || 0, cost: Number(d.cost) || 0, count: Number(d.count) || 0 },
        update: { revenue: Number(d.revenue) || 0, tax: Number(d.tax) || 0, cost: Number(d.cost) || 0, count: Number(d.count) || 0 },
      });
    }
    for (const a of msg.acks || []) {
      const t = await tx.transfer.findUnique({ where: { id: Number(a.id) } });
      if (!t) continue;
      if (a.status === 'SHIPPED' && t.fromBranchId === branch.id && t.status === 'PENDING') await tx.transfer.update({ where: { id: t.id }, data: { status: 'SHIPPED' } });
      if (a.status === 'RECEIVED' && t.toBranchId === branch.id && t.status === 'SHIPPED') await tx.transfer.update({ where: { id: t.id }, data: { status: 'RECEIVED' } });
    }
    await tx.branch.update({ where: { id: branch.id }, data: { lastSyncAt: new Date() } });
  });

  // Work for this branch: items to send out (PENDING, it is the source) and
  // items arriving (SHIPPED, it is the destination).
  const [outgoing, incoming] = await Promise.all([
    prisma.transfer.findMany({ where: { fromBranchId: branch.id, status: 'PENDING' }, include: { items: true } }),
    prisma.transfer.findMany({ where: { toBranchId: branch.id, status: 'SHIPPED' }, include: { items: true } }),
  ]);
  const shape = (t, direction, status) => ({ id: t.id, direction, status, items: t.items.map((i) => ({ barcode: i.barcode, quantity: i.quantity })) });
  return seal(secret, { ts: Date.now(), transfers: [...outgoing.map((t) => shape(t, 'OUT', 'SHIPPED')), ...incoming.map((t) => shape(t, 'IN', 'RECEIVED'))] });
}

function startSync() {
  setInterval(() => pushToHub().catch((e) => console.error('branch sync failed:', e.message)), 5 * 60 * 1000).unref();
}

module.exports = { pushToHub, handleIngest, startSync, seal, open };
