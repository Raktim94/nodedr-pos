// Signed, expiring links to a single receipt PDF — used for "share on
// WhatsApp", e-mailed receipts and the External API's receiptUrl. The link
// carries only an invoice id + expiry and an HMAC over them, keyed with a
// secret derived from the server's JWT secret; nothing is looked up or
// stored, and a link can never be edited to point at another invoice.
const crypto = require('crypto');
const { getJwtSecret } = require('./secret');

const KEY = crypto.createHmac('sha256', getJwtSecret()).update('nodedr-receipt-link-v1').digest();
const DEFAULT_TTL_DAYS = 30;

function sign(payload) {
  return crypto.createHmac('sha256', KEY).update(payload).digest('base64url');
}

// `kind` is part of the signed payload, so a receipt token can never be
// replayed as a customer-portal token (or vice versa) even if ids collide.
function makeToken(kind, id, ttlDays) {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const payload = `${kind}.${id}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

function verifyToken(kind, token) {
  const [p, sig] = String(token).split('.');
  if (!p || !sig) return null;
  let payload;
  try {
    payload = Buffer.from(p, 'base64url').toString();
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [k, id, exp] = payload.split('.');
  if (k !== kind || !Number.isInteger(Number(id)) || Number(exp) < Date.now() / 1000) return null;
  return Number(id);
}

const makeReceiptToken = (invoiceId, ttlDays = DEFAULT_TTL_DAYS) => makeToken('receipt', invoiceId, ttlDays);
const verifyReceiptToken = (token) => verifyToken('receipt', token);
// Customer portal links are long-lived (a year) — they're a bookmark, not a one-off share.
const makePortalToken = (customerId) => makeToken('portal', customerId, 365);
const verifyPortalToken = (token) => verifyToken('portal', token);

function receiptUrl(baseUrl, invoiceId) {
  return `${String(baseUrl).replace(/\/$/, '')}/api/public/receipt/${makeReceiptToken(invoiceId)}`;
}

module.exports = { makeReceiptToken, verifyReceiptToken, makePortalToken, verifyPortalToken, receiptUrl };
