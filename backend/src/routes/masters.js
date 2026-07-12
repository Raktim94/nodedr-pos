const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Bulk reference data (HSN/SAC codes, PIN codes, IFSC codes) is admin-
// imported from CSV rather than bundled with the app — see README >
// Reference data & validation for why. Each import REPLACES the existing
// rows for that dataset (a full refresh, not an incremental merge), so
// re-importing an updated official file is always safe.

function lowercaseKeys(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k.trim().toLowerCase()] = typeof v === 'string' ? v.trim() : v;
  return out;
}

function parseCsv(buffer) {
  return parse(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true }).map(lowercaseKeys);
}

// SQLite (unlike Postgres/MySQL) doesn't support Prisma's `skipDuplicates`
// on createMany, so a messy source CSV with repeated keys would otherwise
// crash the import on a unique-constraint error — de-dupe here instead
// (last occurrence of a given key wins).
async function chunkedCreateMany(model, rows, keyFn, chunkSize = 200) {
  const deduped = [...new Map(rows.map((r) => [keyFn(r), r])).values()];
  for (let i = 0; i < deduped.length; i += chunkSize) {
    await model.createMany({ data: deduped.slice(i, i + chunkSize) });
  }
  return deduped.length;
}

// GET /api/masters/summary — row counts for the Reference Data settings tab
router.get('/summary', async (req, res) => {
  const [hsn, sac, pincodes, ifsc] = await Promise.all([
    prisma.taxCode.count({ where: { type: 'HSN' } }),
    prisma.taxCode.count({ where: { type: 'SAC' } }),
    prisma.pinCode.count(),
    prisma.ifscCode.count(),
  ]);
  res.json({ hsn, sac, pincodes, ifsc });
});

// POST /api/masters/tax-codes/import?type=HSN|SAC  (multipart, field name "file")
// CSV columns: code,description,gstRate (gstRate optional)
router.post('/tax-codes/import', requireAdmin, upload.single('file'), async (req, res) => {
  const type = (req.query.type || '').toString().toUpperCase();
  if (type !== 'HSN' && type !== 'SAC') return res.status(400).json({ error: 'type must be HSN or SAC' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let rows;
  try {
    rows = parseCsv(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }

  const data = rows
    .filter((r) => r.code)
    .map((r) => ({
      type,
      code: String(r.code).trim(),
      description: String(r.description || '').trim(),
      gstRate: r.gstrate ? Number(r.gstrate) : null,
    }));
  if (data.length === 0) return res.status(400).json({ error: 'No valid rows found (expected a "code" column)' });

  await prisma.taxCode.deleteMany({ where: { type } });
  const imported = await chunkedCreateMany(prisma.taxCode, data, (r) => `${r.type}:${r.code}`);
  res.json({ imported, type });
});

// GET /api/masters/tax-codes/search?q=&type=HSN|SAC — typeahead for the product HSN/SAC field
router.get('/tax-codes/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const type = (req.query.type || '').toString().toUpperCase();
  if (!q) return res.json([]);
  const results = await prisma.taxCode.findMany({
    where: {
      ...(type ? { type } : {}),
      OR: [{ code: { startsWith: q } }, { description: { contains: q } }],
    },
    take: 20,
    orderBy: { code: 'asc' },
  });
  res.json(results);
});

// POST /api/masters/pincodes/import (multipart, field name "file")
// CSV columns: pincode,area,district,state
router.post('/pincodes/import', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let rows;
  try {
    rows = parseCsv(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }

  const data = rows
    .filter((r) => r.pincode)
    .map((r) => ({
      pincode: String(r.pincode).trim(),
      area: r.area ? String(r.area).trim() : null,
      district: r.district ? String(r.district).trim() : null,
      state: r.state ? String(r.state).trim() : null,
    }));
  if (data.length === 0) return res.status(400).json({ error: 'No valid rows found (expected a "pincode" column)' });

  await prisma.pinCode.deleteMany({});
  const imported = await chunkedCreateMany(prisma.pinCode, data, (r) => r.pincode);
  res.json({ imported });
});

// GET /api/masters/pincodes/:pincode — address autofill lookup
router.get('/pincodes/:pincode', async (req, res) => {
  const record = await prisma.pinCode.findUnique({ where: { pincode: req.params.pincode.trim() } });
  if (!record) return res.status(404).json({ error: 'PIN code not found' });
  res.json(record);
});

// POST /api/masters/ifsc/import (multipart, field name "file")
// CSV columns: ifsc,bank,branch,address,district,state
router.post('/ifsc/import', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let rows;
  try {
    rows = parseCsv(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }

  const data = rows
    .filter((r) => r.ifsc)
    .map((r) => ({
      ifsc: String(r.ifsc).trim().toUpperCase(),
      bank: r.bank ? String(r.bank).trim() : null,
      branch: r.branch ? String(r.branch).trim() : null,
      address: r.address ? String(r.address).trim() : null,
      district: r.district ? String(r.district).trim() : null,
      state: r.state ? String(r.state).trim() : null,
    }));
  if (data.length === 0) return res.status(400).json({ error: 'No valid rows found (expected an "ifsc" column)' });

  await prisma.ifscCode.deleteMany({});
  const imported = await chunkedCreateMany(prisma.ifscCode, data, (r) => r.ifsc);
  res.json({ imported });
});

// GET /api/masters/ifsc/:code — standalone bank/branch lookup
router.get('/ifsc/:code', async (req, res) => {
  const record = await prisma.ifscCode.findUnique({ where: { ifsc: req.params.code.trim().toUpperCase() } });
  if (!record) return res.status(404).json({ error: 'IFSC code not found' });
  res.json(record);
});

module.exports = router;
