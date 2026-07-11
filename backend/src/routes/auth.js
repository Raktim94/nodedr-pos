const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { issueToken, setSessionCookie, clearSessionCookie, requireAuth } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// GET /api/auth/status — used by the frontend to decide onboarding vs login vs app
router.get('/status', async (req, res) => {
  const adminCount = await prisma.user.count();
  res.json({ onboarded: adminCount > 0 });
});

// POST /api/auth/register — only allowed once, during onboarding Step 1
router.post('/register', async (req, res) => {
  const existing = await prisma.user.count();
  if (existing > 0) {
    return res.status(403).json({ error: 'An admin account already exists' });
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const { name, email, password } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, password: passwordHash },
  });

  const token = issueToken(user);
  setSessionCookie(res, token);
  res.status(201).json({ id: user.id, name: user.name, email: user.email });
});

router.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const genericError = { error: 'Invalid email or password' };
  if (!user) return res.status(401).json(genericError);

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json(genericError);

  const token = issueToken(user);
  setSessionCookie(res, token);
  res.json({ id: user.id, name: user.name, email: user.email });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: user.id, name: user.name, email: user.email });
});

module.exports = router;
