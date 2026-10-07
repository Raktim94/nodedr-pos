const express = require('express');
const { requireAuth, requireAdmin, requirePasswordConfirm } = require('../middleware/auth');
const { getStatus, applyUpdate, getProgress } = require('../lib/update');

const router = express.Router();

// GET /api/update/status[?refresh=1] — current vs latest version (admins only:
// it drives the "update available" banner and the Settings > Updates tab).
router.get('/status', requireAuth, requireAdmin, async (req, res) => {
  res.json(await getStatus({ force: req.query.refresh === '1' }));
});

// POST /api/update/apply — hands off to the updater container, which pulls
// the latest images and restarts this app. Step-up password like other
// sensitive admin actions.
router.post('/apply', requireAuth, requireAdmin, requirePasswordConfirm, async (req, res) => {
  try {
    const { version } = await applyUpdate();
    res.status(202).json({ status: 'updating', version });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/update/progress — what the updater is doing right now, so the UI can
// show a failure (e.g. no internet to pull the images) instead of waiting.
router.get('/progress', requireAuth, requireAdmin, async (req, res) => {
  res.json(await getProgress());
});

module.exports = router;
