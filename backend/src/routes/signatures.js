const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { readSignature, NAME_RE } = require('../lib/signatures');

const router = express.Router();
router.use(requireAuth);

// GET /api/signatures/:name — serves a stored signature image. Names are
// content hashes, so the response is immutable and safely cacheable by the
// signed-in browser (overrides the app-wide no-store; private, never shared).
router.get('/:name', (req, res) => {
  const name = req.params.name;
  const buf = NAME_RE.test(name) ? readSignature(name) : null;
  if (!buf) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(name.endsWith('.png') ? 'image/png' : 'image/jpeg');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(buf);
});

module.exports = router;
