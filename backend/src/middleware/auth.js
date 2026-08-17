const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getJwtSecret } = require('../lib/secret');
const prisma = require('../lib/prisma');

const JWT_SECRET = getJwtSecret();
const TOKEN_COOKIE = 'nodedr_session';
// This is a single-till, physically-trusted device (see README) — once
// signed in, a shopkeeper shouldn't have to re-enter their password every
// shift just because 12 hours passed. A long-lived session here is the
// "same device" side of that; verifyPassword() below is the "except for
// important actions" side — sensitive routes re-check the password inline
// rather than relying on session length for protection.
const TOKEN_TTL = '30d';
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: TOKEN_TTL,
  });
}

function setSessionCookie(res, token) {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: TOKEN_MAX_AGE_MS,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(TOKEN_COOKIE, { path: '/' });
}

// Verifies the session cookie AND re-checks the user still exists and is
// active on every request, so a deactivated account is locked out
// immediately rather than staying valid until the token expires.
async function requireAuth(req, res, next) {
  const token = req.cookies?.[TOKEN_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Account not found or disabled' });
  }

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
}

// Non-blocking session check: returns the token payload if a valid session
// cookie is present, else null. Unlike requireAuth it never responds — for
// endpoints that serve BOTH logged-in and anonymous callers different data
// (e.g. GET /api/settings hides tax identifiers from anonymous LAN clients).
function readSession(req) {
  const token = req.cookies?.[TOKEN_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Step-up re-authentication: even on a long-lived "same device" session
// (see TOKEN_TTL above), a handful of actions re-check the password inline
// — creating/editing staff logins, changing shop/tax settings, and
// issuing refunds/store credit. Callers read the plaintext password from
// wherever their own request schema puts it (usually `confirmPassword`)
// and pass it here alongside the authenticated user's id.
//
// Same failed-attempt budget as loginLimiter (10 / 15min), tracked
// in-memory per user id — none of these routes are the actual /login
// endpoint, so loginLimiter never covers them, but a valid (e.g. stolen)
// session cookie could otherwise be used to brute-force the account
// password against this check with no throttling at all. A single-process
// in-memory Map matches how this app already runs (see docker-compose.yml:
// one backend instance, no clustering) — this is not meant to survive a
// restart, only to slow down an online guessing attempt while it's happening.
const FAILED_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const FAILED_ATTEMPT_LIMIT = 10;
const failedPasswordAttempts = new Map(); // userId -> { count, resetAt }

function tooManyFailedAttempts(userId) {
  const entry = failedPasswordAttempts.get(userId);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    failedPasswordAttempts.delete(userId);
    return false;
  }
  return entry.count >= FAILED_ATTEMPT_LIMIT;
}

function recordFailedAttempt(userId) {
  const entry = failedPasswordAttempts.get(userId);
  if (!entry || Date.now() > entry.resetAt) {
    failedPasswordAttempts.set(userId, { count: 1, resetAt: Date.now() + FAILED_ATTEMPT_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

async function verifyPassword(userId, password) {
  if (!password) return false;
  if (tooManyFailedAttempts(userId)) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  const ok = await bcrypt.compare(password, user.password);
  if (ok) {
    failedPasswordAttempts.delete(userId);
  } else {
    recordFailedAttempt(userId);
  }
  return ok;
}

// Express middleware wrapping verifyPassword() — must run after requireAuth
// (needs req.user) and expects the plaintext password at
// req.body.confirmPassword. Responds with a distinct `code` so the frontend
// can show a "confirm your password" prompt instead of treating this like a
// session-expired 401.
async function requirePasswordConfirm(req, res, next) {
  const ok = await verifyPassword(req.user.id, req.body?.confirmPassword);
  if (!ok) {
    return res.status(401).json({ error: 'Confirm your password to continue', code: 'PASSWORD_CONFIRM_REQUIRED' });
  }
  next();
}

module.exports = {
  issueToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  requirePasswordConfirm,
  verifyPassword,
  readSession,
  TOKEN_COOKIE,
};
