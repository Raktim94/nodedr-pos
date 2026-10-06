const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin, requirePasswordConfirm } = require('../middleware/auth');
const { buildUpiUri } = require('../lib/upi');
const { CURRENCIES } = require('../lib/currency');
const { parseRates, refreshLiveRates, saveRates } = require('../lib/fx');
const { encryptJson, decryptJson } = require('../lib/secretBox');
const terminal = require('../lib/terminal');
const { receiptUrl } = require('../lib/publicLink');

const router = express.Router();
router.use(requireAuth);

// GET /api/payments/upi?amount=&ref= — UPI deep link for the exact sale
// amount; the POS renders it as a QR the customer scans.
router.get('/upi', async (req, res) => {
  const shop = await prisma.shopSettings.findFirst();
  if (!shop?.upiId) return res.status(409).json({ error: 'Add your UPI id in Settings > Payments first' });
  const amount = Number(req.query.amount);
  if (!(amount > 0) || amount > 10_000_000) return res.status(400).json({ error: 'Invalid amount' });
  const ref = String(req.query.ref || '').slice(0, 35);
  res.json({ vpa: shop.upiId, amount, uri: buildUpiUri({ vpa: shop.upiId, name: shop.shopName, amount, note: ref ? `Bill ${ref}` : undefined, ref: ref || undefined }) });
});

// ---- multi-currency --------------------------------------------------------

router.get('/fx', async (req, res) => {
  const s = await prisma.shopSettings.findFirst();
  res.json({ base: s?.currencyCode || 'INR', rates: parseRates(s), updatedAt: s?.fxUpdatedAt || null });
});

const ratesSchema = z.object({ rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive().max(1e9)) });
router.put('/fx', requireAdmin, async (req, res) => {
  const parsed = ratesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid rates' });
  for (const code of Object.keys(parsed.data.rates)) {
    if (!CURRENCIES[code]) return res.status(400).json({ error: `Unsupported currency ${code}` });
  }
  const s = await saveRates(parsed.data.rates);
  res.json({ base: s.currencyCode, rates: parseRates(s), updatedAt: s.fxUpdatedAt });
});

router.post('/fx/refresh', requireAdmin, async (req, res) => {
  const s = await prisma.shopSettings.findFirst();
  if (!s) return res.status(404).json({ error: 'No shop settings' });
  try {
    const rates = await refreshLiveRates(s.currencyCode);
    const updated = await saveRates(rates);
    res.json({ base: updated.currencyCode, rates, updatedAt: updated.fxUpdatedAt });
  } catch (err) {
    res.status(502).json({ error: `Could not fetch live rates (${err.message}). Enter rates manually if you're offline.` });
  }
});

// ---- card terminal -----------------------------------------------------------

router.get('/terminal-config', requireAdmin, async (req, res) => {
  const s = await prisma.shopSettings.findFirst();
  const cfg = decryptJson(s?.terminalConfigEnc) || {};
  // Never echo the secret back — only whether one is stored.
  res.json({ provider: s?.terminalProvider || 'none', configured: Boolean(cfg.secret), readerId: cfg.readerId || '', deviceId: cfg.deviceId || '', sandbox: Boolean(cfg.sandbox) });
});

const cfgSchema = z.object({
  provider: z.enum(['none', 'stripe', 'square']),
  secret: z.string().trim().min(8).max(300).optional(),
  readerId: z.string().trim().max(100).optional(),
  deviceId: z.string().trim().max(100).optional(),
  sandbox: z.boolean().optional(),
});
router.put('/terminal-config', requireAdmin, requirePasswordConfirm, async (req, res) => {
  const parsed = cfgSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const s = await prisma.shopSettings.findFirst();
  if (!s) return res.status(404).json({ error: 'No shop settings' });
  const prev = decryptJson(s.terminalConfigEnc) || {};
  const next = { ...prev, ...Object.fromEntries(Object.entries(parsed.data).filter(([k, v]) => k !== 'provider' && v !== undefined)) };
  await prisma.shopSettings.update({
    where: { id: s.id },
    data: { terminalProvider: parsed.data.provider, terminalConfigEnc: parsed.data.provider === 'none' ? null : encryptJson(next) },
  });
  res.json({ ok: true });
});

router.post('/terminal/charge', async (req, res) => {
  const parsed = z.object({ amount: z.number().positive().max(10_000_000), reference: z.string().trim().max(60).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid amount' });
  try {
    res.status(201).json(await terminal.startCharge(parsed.data));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/terminal/status/:id', async (req, res) => {
  try {
    res.json(await terminal.getStatus(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/terminal/cancel/:id', async (req, res) => {
  try {
    await terminal.cancel(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- WhatsApp / share ----------------------------------------------------------

// GET /api/payments/share/:invoiceId — a wa.me link pre-filled with the bill
// summary and a signed PDF link. No WhatsApp Business API or account needed:
// the cashier taps send in their own WhatsApp.
router.get('/share/:invoiceId', async (req, res) => {
  const id = Number(req.params.invoiceId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid invoice id' });
  const [inv, shop] = await Promise.all([prisma.invoice.findUnique({ where: { id } }), prisma.shopSettings.findFirst()]);
  if (!inv || !shop) return res.status(404).json({ error: 'Invoice not found' });
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const link = receiptUrl(base, inv.id);
  const text = `Thank you for shopping at ${shop.shopName}!\nBill ${inv.invoiceNumber}: ${shop.currencySymbol} ${inv.totalAmount.toFixed(2)}\nYour receipt: ${link}`;
  let phone = String(req.query.phone || inv.customerPhone || '').replace(/\D/g, '');
  if (phone.length === 10 && shop.currencyCode === 'INR') phone = `91${phone}`;
  const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  res.json({ whatsappUrl, receiptUrl: link, text, hasPhone: Boolean(phone) });
});

module.exports = router;
