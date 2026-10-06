// Signature images (shop's authorised signatory, customer signing at the
// till) are kept as files under data/signatures/, never in SQLite — the DB
// only holds the file name, so list/settings queries stay small and fast.
//
// Input is a PNG/JPEG data URL or raw base64. The bytes are checked by magic
// number (not the claimed MIME type), size-capped, and stored under a
// content-hash name, so a caller can never choose the path or write a
// non-image file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', '..', 'data', 'signatures');
const MAX_BYTES = 300 * 1024;

function sniff(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

function saveSignature(input) {
  if (typeof input !== 'string' || input.length === 0) throw Object.assign(new Error('Signature image required'), { status: 400 });
  const b64 = input.replace(/^data:image\/(png|jpe?g);base64,/i, '');
  if (b64.length > MAX_BYTES * 1.4) throw Object.assign(new Error('Signature image too large (max 300 KB)'), { status: 413 });
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0 || buf.length > MAX_BYTES) throw Object.assign(new Error('Signature image too large (max 300 KB)'), { status: 413 });
  const ext = sniff(buf);
  if (!ext) throw Object.assign(new Error('Signature must be a PNG or JPEG image'), { status: 400 });
  const name = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`;
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf, { mode: 0o600 });
  return name;
}

const NAME_RE = /^[a-f0-9]{32}\.(png|jpg)$/;

// Returns the image bytes for a stored name, or null. The name pattern check
// makes path traversal impossible even if a bad value ever reached the DB.
function readSignature(name) {
  if (!name || !NAME_RE.test(name)) return null;
  try {
    return fs.readFileSync(path.join(DIR, name));
  } catch {
    return null;
  }
}

module.exports = { saveSignature, readSignature, NAME_RE };
