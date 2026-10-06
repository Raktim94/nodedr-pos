const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin, requirePasswordConfirm } = require('../middleware/auth');
const stores = require('../lib/stores');
const { encryptJson, decryptJson, decrypt } = require('../lib/secretBox');

// ---- admin management (session auth) ----
const admin = express.Router();
admin.use(requireAuth, requireAdmin);

const base = (req) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
const view = (i, req) => {
  const cfg = decryptJson(i.configEnc) || {};
  return {
    id: i.id, platform: i.platform, name: i.name, active: i.active, lastEventAt: i.lastEventAt, createdAt: i.createdAt,
    webhookUrl: `${base(req).replace(/\/$/, '')}/api/webhooks/${i.platform}/${i.id}`,
    outboundConfigured: Boolean(cfg.baseUrl || cfg.shopDomain),
    baseUrl: cfg.baseUrl || '', shopDomain: cfg.shopDomain || '', locationId: cfg.locationId || '',
  };
};

admin.get('/', async (req, res) => res.json((await prisma.integration.findMany({ orderBy: { id: 'desc' } })).map((i) => view(i, req))));

const createSchema = z.object({ platform: z.enum(['woocommerce', 'shopify', 'generic']), name: z.string().trim().min(1).max(120) });
// The webhook secret is returned ONCE here (paste it into the store's webhook
// settings); only its encrypted form is kept.
admin.post('/', requirePasswordConfirm, async (req, res) => {
  const p = createSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid input' });
  const secret = stores.newWebhookSecret();
  const created = await prisma.integration.create({ data: { ...p.data, secretEnc: stores.encrypt(secret) } });
  res.status(201).json({ ...view(created, req), webhookSecret: secret });
});

const configSchema = z.object({
  active: z.boolean().optional(),
  // WooCommerce outbound
  baseUrl: z.string().trim().url().max(300).refine((u) => u.startsWith('https://'), 'Use https://').optional(),
  consumerKey: z.string().trim().max(200).optional(),
  consumerSecret: z.string().trim().max(200).optional(),
  // Shopify outbound
  shopDomain: z.string().trim().regex(/^[a-z0-9-]+\.myshopify\.com$/i).optional(),
  accessToken: z.string().trim().max(200).optional(),
  locationId: z.string().trim().max(200).optional(),
});
admin.put('/:id', requirePasswordConfirm, async (req, res) => {
  const id = Number(req.params.id);
  const p = configSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !p.success) return res.status(400).json({ error: 'Invalid input' });
  const it = await prisma.integration.findUnique({ where: { id } });
  if (!it) return res.status(404).json({ error: 'Not found' });
  const { active, ...cfgPatch } = p.data;
  const prev = decryptJson(it.configEnc) || {};
  const next = { ...prev, ...Object.fromEntries(Object.entries(cfgPatch).filter(([, v]) => v !== undefined)) };
  const updated = await prisma.integration.update({
    where: { id },
    data: { ...(active !== undefined ? { active } : {}), ...(Object.keys(cfgPatch).length ? { configEnc: encryptJson(next) } : {}) },
  });
  res.json(view(updated, req));
});

admin.delete('/:id', requirePasswordConfirm, async (req, res) => {
  try {
    await prisma.integration.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// ---- inbound webhook (public; trust = HMAC) ----
const hook = express.Router();
hook.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // Keyed by integration id, not IP: a platform calls from a rotating pool.
  keyGenerator: (req) => `wh:${req.params.id}`,
  validate: { keyGeneratorIpFallback: false },
}));

hook.post('/:platform/:id', async (req, res) => {
  const id = Number(req.params.id);
  const platform = String(req.params.platform);
  // Same 404 whether the id is unknown, inactive, or a different platform.
  const it = Number.isInteger(id) && stores.SCHEMES[platform] ? await prisma.integration.findUnique({ where: { id } }) : null;
  if (!it || !it.active || it.platform !== platform) return res.status(404).json({ error: 'Not found' });
  const secret = decrypt(it.secretEnc);
  if (!secret) return res.status(503).json({ error: 'Integration secret unreadable' });
  if (!stores.verifySignature(platform, req.rawBody, req.get(stores.SCHEMES[platform].header), secret)) {
    return res.status(401).json({ error: 'Bad signature' });
  }
  try {
    prisma.integration.update({ where: { id }, data: { lastEventAt: new Date() } }).catch(() => {});
    const out = await stores.ingest(it, req.body || {});
    if (out.ignored) return res.status(202).json({ ignored: out.ignored });
    res.json({ orderId: out.order.id, deduplicated: out.deduplicated });
  } catch (err) {
    if (!err.status) console.error(err);
    // 5xx makes the store retry later; 4xx is a payload we'll never accept.
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not process order' });
  }
});

module.exports = { admin, hook };
