// AES-256-GCM encryption for third-party secrets stored in the database
// (card-terminal keys, SMTP password, webhook secrets, sync secret), so a
// leaked database file or backup doesn't hand over live credentials. The key
// is derived from the server's JWT secret (data/.jwt-secret), which lives
// outside the database — keep them in separate backups.
const crypto = require('crypto');
const { getJwtSecret } = require('./secret');

const KEY = crypto.createHmac('sha256', getJwtSecret()).update('nodedr-secretbox-v1').digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

function decrypt(blob) {
  if (!blob) return null;
  const [v, iv, tag, ct] = String(blob).split('.');
  if (v !== 'v1' || !iv || !tag || !ct) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null; // wrong key or tampered blob
  }
}

const encryptJson = (obj) => encrypt(JSON.stringify(obj));
function decryptJson(blob) {
  const t = decrypt(blob);
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt, encryptJson, decryptJson };
