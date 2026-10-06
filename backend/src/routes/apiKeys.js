const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin, requirePasswordConfirm } = require('../middleware/auth');
const { generateApiKey, generateWebhookSecret, SCOPES, parseScopes } = require('../lib/apiKey');

const router = express.Router();
// Managing integrations is an admin-only, always-authenticated action —
// distinct from the External API itself (routes/external.js), which is
// authenticated by the keys created here, not by a session cookie.
router.use(requireAuth, requireAdmin);

function publicView(key) {
  // Never return keyHash or webhookSecret once created — the plaintext key
  // and the webhook secret are shown to the admin exactly once, in the
  // POST response below, and must be copied down then.
  const { keyHash, webhookSecret, ...rest } = key;
  void keyHash;
  return { ...rest, scopes: parseScopes(rest.scopes), webhookSecretSet: Boolean(webhookSecret) };
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  canWrite: z.boolean().default(false),
  scopes: z.array(z.enum(SCOPES)).min(1).optional(),
  webhookUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), { message: 'Webhook URL must use https://' })
    .optional()
    .or(z.literal('')),
  confirmPassword: z.string().optional(),
});

// GET /api/api-keys — list integrations (no secrets)
router.get('/', async (req, res) => {
  const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(keys.map(publicView));
});

// POST /api/api-keys — create a new integration credential. The plaintext
// key (and webhook secret, if a webhook URL was given) are returned ONLY
// in this response — there is no way to retrieve them again afterward.
router.post('/', requirePasswordConfirm, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const { name, webhookUrl } = parsed.data;
  // Explicit scopes win; the legacy canWrite flag still maps to stock:write.
  const scopes = parsed.data.scopes ?? (parsed.data.canWrite ? ['products:read', 'stock:write'] : ['products:read']);
  const canWrite = scopes.includes('stock:write');
  const { plaintext, keyPrefix, keyHash } = generateApiKey();
  const webhookSecret = webhookUrl ? generateWebhookSecret() : null;

  const created = await prisma.apiKey.create({
    data: { name, canWrite, scopes: scopes.join(','), webhookUrl: webhookUrl || null, webhookSecret, keyPrefix, keyHash },
  });

  res.status(201).json({ ...publicView(created), apiKey: plaintext, webhookSecret });
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  canWrite: z.boolean().optional(),
  scopes: z.array(z.enum(SCOPES)).min(1).optional(),
  webhookUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), { message: 'Webhook URL must use https://' })
    .optional()
    .or(z.literal('')),
  revoked: z.boolean().optional(),
});

// PUT /api/api-keys/:id — rename, flip write access, change/clear the
// webhook URL, or revoke. Partial: only sent fields change (same
// no-`.default()` convention as every other partial-update schema in this
// codebase, see settings.js). Revoking is permanent from the caller's
// side — there is no "unrevoke"; issue a new key instead, same as a GitHub PAT.
router.put('/:id', requirePasswordConfirm, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const data = { ...parsed.data };
  if (data.scopes) {
    data.canWrite = data.scopes.includes('stock:write');
    data.scopes = data.scopes.join(',');
  } else if (data.canWrite !== undefined) {
    data.scopes = data.canWrite ? 'products:read,stock:write' : 'products:read';
  }
  // Changing the webhook URL invalidates the old signature relationship —
  // rotate the secret so a stale/compromised old secret can't still verify.
  if ('webhookUrl' in data) {
    data.webhookUrl = data.webhookUrl || null;
    data.webhookSecret = data.webhookUrl ? generateWebhookSecret() : null;
  }

  try {
    const updated = await prisma.apiKey.update({ where: { id }, data });
    const body = publicView(updated);
    if (data.webhookSecret) body.webhookSecret = data.webhookSecret; // shown once, same as creation
    res.json(body);
  } catch {
    res.status(404).json({ error: 'API key not found' });
  }
});

// DELETE /api/api-keys/:id — hard delete.
router.delete('/:id', requirePasswordConfirm, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await prisma.apiKey.delete({ where: { id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'API key not found' });
  }
});

module.exports = router;
