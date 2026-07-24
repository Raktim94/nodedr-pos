const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../lib/secret');
const prisma = require('../lib/prisma');

const JWT_SECRET = getJwtSecret();
const TOKEN_COOKIE = 'nodedr_session';
const TOKEN_TTL = '12h';

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
    maxAge: 12 * 60 * 60 * 1000,
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

module.exports = {
  issueToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  readSession,
  TOKEN_COOKIE,
};
