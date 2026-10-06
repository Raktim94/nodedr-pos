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

function makeReceiptToken(invoiceId, ttlDays = DEFAULT_TTL_DAYS) {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const payload = `${invoiceId}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

function verifyReceiptToken(token) {
  const [p, sig] = String(token).split('.');
  if (!p || !sig) return null;
  let payload;
  try {
    payload = Buffer.from(p, 'base64url').toString();
  } catch {
    return null;
  }
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [id, exp] = payload.split('.').map(Number);
  if (!Number.isInteger(id) || !Number.isInteger(exp) || exp < Date.now() / 1000) return null;
  return id;
}

function receiptUrl(baseUrl, invoiceId) {
  return `${String(baseUrl).replace(/\/$/, '')}/api/public/receipt/${makeReceiptToken(invoiceId)}`;
}

module.exports = { makeReceiptToken, verifyReceiptToken, receiptUrl };
