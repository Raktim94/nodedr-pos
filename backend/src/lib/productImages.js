// Product photos are files under data/product-images/, never in SQLite — the
// DB holds only the file name (Product.imageFile), so product lists stay small.
//
// Bytes are checked by magic number (PNG / JPEG / WebP), size-capped and stored
// under a content-hash name, so callers can't choose a path or store a non-image.
// Photos can arrive as an uploaded data URL or, for the "Find online" flow, as
// an https URL on one of the Open *Facts hosts — fetched server-side, never
// from an arbitrary host (no SSRF).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', '..', 'data', 'product-images');
const MAX_BYTES = 800 * 1024;
const NAME_RE = /^[a-f0-9]{32}\.(png|jpg|webp)$/;
const REMOTE_HOST_RE = /^(images|static)\.openfoodfacts\.org$|^(images|static)\.openbeautyfacts\.org$|^(images|static)\.openproductsfacts\.org$/;

function sniff(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function store(buf) {
  if (buf.length === 0 || buf.length > MAX_BYTES) throw Object.assign(new Error('Product image too large (max 800 KB)'), { status: 413 });
  const ext = sniff(buf);
  if (!ext) throw Object.assign(new Error('Product image must be a PNG, JPEG or WebP file'), { status: 400 });
  const name = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`;
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf, { mode: 0o600 });
  return name;
}

function saveProductImage(input) {
  if (typeof input !== 'string' || input.length === 0) throw Object.assign(new Error('Product image required'), { status: 400 });
  const b64 = input.replace(/^data:image\/(png|jpe?g|webp);base64,/i, '');
  if (b64.length > MAX_BYTES * 1.4) throw Object.assign(new Error('Product image too large (max 800 KB)'), { status: 413 });
  return store(Buffer.from(b64, 'base64'));
}

// Best-effort: returns the stored name, or null if the URL is not an allowed
// host / unreachable / not a real image. Never throws — a missing photo must
// not block saving the product.
async function fetchRemoteProductImage(url, fetchImpl = fetch) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !REMOTE_HOST_RE.test(u.hostname)) return null;
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return store(buf);
  } catch {
    return null;
  }
}

function readProductImage(name) {
  if (!name || !NAME_RE.test(name)) return null;
  try {
    return fs.readFileSync(path.join(DIR, name));
  } catch {
    return null;
  }
}

module.exports = { saveProductImage, fetchRemoteProductImage, readProductImage, NAME_RE };
