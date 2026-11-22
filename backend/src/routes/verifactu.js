const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const vf = require('../lib/verifactu/service');

const { httpError } = require('../lib/http');
const router = express.Router();
router.use(requireAuth, requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024, files: 1 } });

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'VERI*FACTU request failed' : err.message });
  }
};

router.get('/settings', handle(() => vf.getSettings()));
router.put('/settings', handle((req) => vf.saveSettings(req.body || {})));
router.post(
  '/certificate',
  upload.single('file'),
  handle((req) => {
    if (!req.file) throw httpError('Choose the .p12 or .pfx certificate file.', 400);
    return vf.uploadCertificate(req.file.buffer, String(req.body?.password || ''));
  })
);
router.get('/records', handle((req) => vf.records(Number(req.query.take) || 50, Number(req.query.skip) || 0)));
router.get('/verify', handle(() => vf.verifyChain()));
router.post('/send', handle(() => vf.sendNow()));
router.get('/export.xml', async (req, res) => {
  try {
    res.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="verifactu-records.xml"' });
    res.send(await vf.exportXml());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
