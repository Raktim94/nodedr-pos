const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin, requirePasswordConfirm } = require('../middleware/auth');
const { encryptJson, decryptJson } = require('../lib/secretBox');
const { sendReportNow } = require('../lib/scheduler');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res) => {
  const s = await prisma.shopSettings.findFirst();
  const smtp = decryptJson(s?.smtpConfigEnc) || {};
  res.json({
    reportEmail: s?.reportEmail || '',
    reportFrequency: s?.reportFrequency || 'off',
    smtp: { configured: Boolean(smtp.host), host: smtp.host || '', port: smtp.port || 587, secure: Boolean(smtp.secure), user: smtp.user || '', from: smtp.from || '' },
  });
});

const schema = z.object({
  reportEmail: z.string().trim().email().max(200).or(z.literal('')).optional(),
  reportFrequency: z.enum(['off', 'daily', 'weekly']).optional(),
  smtp: z
    .object({
      host: z.string().trim().min(1).max(200),
      port: z.number().int().min(1).max(65535).default(587),
      secure: z.boolean().default(false),
      user: z.string().trim().max(200).optional(),
      pass: z.string().max(300).optional(), // omit to keep the stored password
      from: z.string().trim().max(200).optional(),
    })
    .optional(),
});

router.put('/', requirePasswordConfirm, async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const s = await prisma.shopSettings.findFirst();
  if (!s) return res.status(404).json({ error: 'No shop settings' });
  const data = {};
  if (parsed.data.reportEmail !== undefined) data.reportEmail = parsed.data.reportEmail || null;
  if (parsed.data.reportFrequency) data.reportFrequency = parsed.data.reportFrequency;
  if (parsed.data.smtp) {
    const prev = decryptJson(s.smtpConfigEnc) || {};
    data.smtpConfigEnc = encryptJson({ ...parsed.data.smtp, pass: parsed.data.smtp.pass ?? prev.pass });
  }
  await prisma.shopSettings.update({ where: { id: s.id }, data });
  res.json({ ok: true });
});

router.post('/send-now', async (req, res) => {
  try {
    await sendReportNow(req.body?.kind === 'weekly' ? 'weekly' : 'daily');
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.status ? err.message : `Could not send: ${err.message}` });
  }
});

module.exports = router;
