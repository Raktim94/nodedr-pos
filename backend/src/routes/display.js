// Customer-facing display, shared across devices.
//
// The till (signed in) pushes what the customer should see — the cart, the
// total, or a UPI payment QR — and any phone / tablet / second screen that
// opens  /display?key=<key>  follows it by polling. The key is a random secret
// kept in data/display-key, so a display needs no login but nobody who doesn't
// hold the link can read the cart. State lives in memory only (it is a live
// mirror, not a record) and is wiped when the till sends an idle state.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const KEY_FILE = path.join(__dirname, '..', '..', 'data', 'display-key');
const MAX_STATE_BYTES = 64 * 1024;

let cachedKey = null;
function displayKey() {
  if (cachedKey) return cachedKey;
  try {
    const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(k)) return (cachedKey = k);
  } catch {}
  const k = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, k, { mode: 0o600 });
  return (cachedKey = k);
}
function keyOk(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(displayKey());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let current = { seq: 0, state: null };
const viewers = new Map(); // viewer id -> last poll time
const VIEWER_TTL_MS = 6000;
const liveViewers = () => {
  const now = Date.now();
  for (const [id, t] of viewers) if (now - t > VIEWER_TTL_MS) viewers.delete(id);
  return viewers.size;
};

// Till side (signed in) ------------------------------------------------------
router.get('/link', requireAuth, (req, res) => res.json({ key: displayKey(), viewers: liveViewers() }));

router.post('/state', requireAuth, (req, res) => {
  const state = req.body;
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.lines)) {
    return res.status(400).json({ error: 'Invalid display state' });
  }
  if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) return res.status(413).json({ error: 'Display state too large' });
  current = { seq: current.seq + 1, state };
  res.json({ seq: current.seq, viewers: liveViewers() });
});

// Display side (key in the URL, no login) ------------------------------------
// ?since=<seq> returns {seq, changed:false} when nothing is new — cheap to poll.
const pollLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false });
router.get('/state', pollLimiter, (req, res) => {
  if (!keyOk(req.query.key)) return res.status(403).json({ error: 'Invalid display link' });
  const vid = String(req.query.v || '').slice(0, 40);
  if (vid) viewers.set(vid, Date.now());
  if (Number(req.query.since) === current.seq) return res.json({ seq: current.seq, changed: false });
  res.json({ seq: current.seq, changed: true, state: current.state });
});

module.exports = router;
