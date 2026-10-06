const prisma = require('../lib/prisma');
const { hashApiKey, parseScopes } = require('../lib/apiKey');

// Authenticates a call to the External Stock API (see routes/external.js)
// against an ApiKey row, instead of the cookie-based session used by the
// rest of the app — this API is meant to be called machine-to-machine by
// an external system (e.g. an e-commerce storefront), which has no browser
// session to send. The key travels as a bearer token; only its hash is ever
// compared, same principle as never comparing plaintext passwords.
//
// `requireWrite` gates the stock-adjustment endpoint: a read-only key
// (the common case — most integrations only need to *display* live stock)
// can look up products but can never modify this shop's inventory.
function requireApiKey({ requireWrite = false, scope = null } = {}) {
  const needed = scope || (requireWrite ? 'stock:write' : null);
  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const key = bearer || req.get('x-api-key');
    if (!key) {
      return res.status(401).json({ error: 'Missing API key (Authorization: Bearer <key>)' });
    }

    const record = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(key) } });
    if (!record || record.revoked) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }
    const scopes = parseScopes(record.scopes);
    if (needed && !scopes.includes(needed)) {
      return res.status(403).json({ error: `This API key lacks the "${needed}" permission` });
    }

    req.apiKey = record;
    req.apiScopes = scopes;
    // Best-effort — a failed "touch" must never block the actual request.
    prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    next();
  };
}

module.exports = { requireApiKey };
