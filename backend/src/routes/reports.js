const express = require('express');
const { requireAuth, requirePerm } = require('../middleware/auth');
const reports = require('../lib/reports');

const router = express.Router();
router.use(requireAuth, requirePerm('reports'));

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Report failed' });
  }
};

router.get('/overview', wrap(async (req, res) => res.json(await reports.overview(req.query.from, req.query.to))));

router.get('/compare', wrap(async (req, res) => {
  const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week';
  res.json(await reports.compare(period));
}));

router.get('/gstr1', wrap(async (req, res) => res.json(await reports.gstr1(String(req.query.month)))));

router.get('/gstr1.csv', wrap(async (req, res) => {
  const report = await reports.gstr1(String(req.query.month));
  const section = String(req.query.section || 'b2cs');
  const csv = reports.gstr1Csv(report, section);
  res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="gstr1-${report.month}-${section}.csv"`).send(csv);
}));

router.get('/tax-summary.csv', wrap(async (req, res) => {
  const csv = await reports.taxSummaryCsv(req.query.from, req.query.to);
  res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="tax-summary.csv"').send(csv);
}));

module.exports = router;
