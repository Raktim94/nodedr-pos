// Bulk product import from CSV / XLSX — modelled on Rechvix's importer:
//   1. file -> uniform rows (header-keyed)
//   2. every row validated; the report lists EVERY row's outcome (nothing is
//      silently dropped): COMMITTED | VALID (dry run) | ERROR | DUPLICATE
//   3. "Preview" (dryRun) writes nothing; "Import" commits all valid rows in
//      ONE transaction (all-or-nothing, and one write lock = fast)
//   4. duplicates are detected against the database AND earlier rows in the
//      same file, and skipped rather than failed
//   5. lookups (supplier) are auto-created on first use
const { parse } = require('csv-parse/sync');
const { readSheet } = require('read-excel-file/universal');
const prisma = require('./prisma');

const MAX_ROWS = 5000;

const COLUMNS = [
  'name', 'barcode', 'sku', 'category', 'hsn', 'unit', 'purchase_price', 'selling_price', 'tax_rate',
  'stock', 'reorder_point', 'discount_type', 'discount_value', 'track_serial', 'warranty_months',
  'supplier',
];

const SAMPLE_ROWS = [
  { name: 'Parle-G Biscuit 200g', barcode: '8901719101014', sku: 'PARLEG-200', category: 'Grocery', hsn: '1905', unit: 'PCS', purchase_price: '8', selling_price: '10', tax_rate: '18', stock: '120', reorder_point: '20', supplier: 'City Distributors' },
  { name: 'Basmati Rice (loose)', barcode: '', category: 'Grocery', hsn: '1006', unit: 'KGS', purchase_price: '70', selling_price: '95', tax_rate: '5', stock: '40.5', reorder_point: '10' },
  { name: 'Redmi 13 5G 8/128', barcode: 'RM13-8-128', category: 'Mobiles', hsn: '8517', unit: 'PCS', purchase_price: '11200', selling_price: '13999', tax_rate: '18', stock: '5', track_serial: 'yes', warranty_months: '12' },
];

// "Selling Price", "selling-price", "SELLING_PRICE" all -> selling_price
const normKey = (k) => String(k ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

async function parseRows(buffer, format) {
  let matrix;
  if (format === 'xlsx') {
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    try {
      matrix = await readSheet(ab);
    } catch {
      throw Object.assign(new Error('Could not read that .xlsx file'), { status: 400 });
    }
  } else {
    try {
      // BOM stripped; ragged rows tolerated (padded below, reported per row).
      matrix = parse(buffer, { bom: true, relax_column_count: true, skip_empty_lines: true });
    } catch (e) {
      throw Object.assign(new Error(`Could not read that CSV (${e.message})`), { status: 400 });
    }
  }
  if (!matrix.length) return [];
  const header = matrix[0].map(normKey);
  if (!header.includes('name') || !header.includes('selling_price')) {
    throw Object.assign(new Error('The first row must be a header containing at least: name, selling_price'), { status: 400 });
  }
  const rows = [];
  matrix.slice(1).forEach((rec, i) => {
    const fields = {};
    header.forEach((h, c) => {
      if (h) fields[h] = rec[c] == null ? '' : String(rec[c]).trim();
    });
    if (Object.values(fields).every((v) => v === '')) return; // blank spreadsheet row
    rows.push({ number: i + 1, fields });
  });
  if (rows.length > MAX_ROWS) throw Object.assign(new Error(`Too many rows (max ${MAX_ROWS} per file) — split the file`), { status: 413 });
  return rows;
}

const num = (raw, label, { min = 0, max = 1e9, int = false } = {}) => {
  if (raw === '' || raw == null) return { ok: true, value: undefined };
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return { ok: false, error: `${label} "${raw}" is not a valid ${int ? 'whole ' : ''}number` };
  return { ok: true, value: n };
};
const bool = (raw) => /^(1|y|yes|true|on)$/i.test(String(raw || '').trim());

// Internal EAN-13 (prefix 2 = in-store use) for rows with no barcode.
function internalEan13(taken) {
  for (let tries = 0; tries < 50; tries++) {
    const body = '2' + String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
    const code = body + ((10 - (sum % 10)) % 10);
    if (!taken.has(code)) return code;
  }
  throw new Error('could not generate a free barcode');
}

async function importProducts(buffer, format, { dryRun }) {
  const rows = await parseRows(buffer, format);
  const results = [];
  const push = (row, outcome, message = '') => results.push({ row: row.number, name: row.fields.name || '', outcome, message });

  // Existing keys, loaded once (not one query per row).
  const [prods, suppliers] = await Promise.all([
    prisma.product.findMany({ select: { barcode: true, sku: true, name: true } }),
    prisma.supplier.findMany({ select: { id: true, name: true } }),
  ]);
  const barcodes = new Set(prods.map((p) => p.barcode));
  const skus = new Set(prods.map((p) => p.sku).filter(Boolean));
  const names = new Set(prods.map((p) => p.name.trim().toLowerCase()));
  const supplierId = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const newSuppliers = new Set();
  const toCreate = [];

  for (const row of rows) {
    const f = row.fields;
    const name = f.name;
    if (!name) { push(row, 'ERROR', 'name is required'); continue; }
    if (name.length > 200) { push(row, 'ERROR', 'name is longer than 200 characters'); continue; }
    if (f.selling_price === '') { push(row, 'ERROR', 'selling_price is required'); continue; }

    const sell = num(f.selling_price, 'selling_price');
    const buy = num(f.purchase_price, 'purchase_price');
    const tax = num(f.tax_rate, 'tax_rate', { max: 100 });
    const stock = num(f.stock, 'stock', { max: 1_000_000 });
    const reorder = num(f.reorder_point, 'reorder_point', { max: 1_000_000 });
    const dval = num(f.discount_value, 'discount_value');
    const warranty = num(f.warranty_months, 'warranty_months', { max: 240, int: true });
    const bad = [sell, buy, tax, stock, reorder, dval, warranty].find((x) => !x.ok);
    if (bad) { push(row, 'ERROR', bad.error); continue; }

    const dtype = f.discount_type ? f.discount_type.toLowerCase() : '';
    if (dtype && !['percent', 'amount'].includes(dtype)) { push(row, 'ERROR', 'discount_type must be "percent" or "amount"'); continue; }
    if (dtype === 'percent' && (dval.value || 0) > 100) { push(row, 'ERROR', 'a percent discount cannot exceed 100'); continue; }
    if (dtype === 'amount' && (dval.value || 0) > sell.value) { push(row, 'ERROR', 'a flat discount cannot exceed the selling price'); continue; }
    if (f.unit && f.unit.length > 10) { push(row, 'ERROR', 'unit is longer than 10 characters'); continue; }
    if (f.hsn && f.hsn.length > 20) { push(row, 'ERROR', 'hsn is longer than 20 characters'); continue; }

    // Duplicates: a barcode/SKU already in the DB or earlier in this file.
    let barcode = f.barcode;
    if (barcode) {
      if (barcodes.has(barcode)) { push(row, 'DUPLICATE', `barcode ${barcode} already exists`); continue; }
    } else if (names.has(name.toLowerCase())) {
      push(row, 'DUPLICATE', `a product named "${name}" already exists`);
      continue;
    }
    if (f.sku) {
      if (f.sku.length > 64) { push(row, 'ERROR', 'sku is longer than 64 characters'); continue; }
      if (skus.has(f.sku)) { push(row, 'ERROR', `sku ${f.sku} is already used by another product`); continue; }
    }
    if (barcode.length > 64) { push(row, 'ERROR', 'barcode is longer than 64 characters'); continue; }

    // IMEI / serial tracking is a per-product flag only — the numbers themselves
    // are captured when the unit is sold, never imported into stock.
    const track = bool(f.track_serial);
    if (f.serials) { push(row, 'ERROR', 'IMEI / serial numbers are entered at the moment of sale, not imported — remove the serials column'); continue; }

    // Row is good — claim its keys so later rows in the file collide with it.
    const notes = [];
    if (!barcode) {
      barcode = internalEan13(barcodes);
      notes.push(`barcode generated: ${barcode}`);
    }
    barcodes.add(barcode);
    names.add(name.toLowerCase());
    if (f.sku) skus.add(f.sku);
    let sid = null;
    if (f.supplier) {
      const key = f.supplier.toLowerCase();
      if (!supplierId.has(key)) newSuppliers.add(f.supplier);
      sid = key;
    }
    toCreate.push({
      row,
      data: {
        barcode, sku: f.sku || null, name, category: f.category || null, hsn: f.hsn || null, unit: f.unit ? f.unit.toUpperCase() : null,
        purchasePrice: buy.value ?? 0, sellingPrice: sell.value, taxRate: tax.value ?? 0,
        discountType: dtype || null, discountValue: dtype ? dval.value ?? 0 : 0,
        stock: stock.value ?? 0, reorderPoint: reorder.value ?? 0,
        trackSerial: track, warrantyMonths: warranty.value ?? 0,
      },
      supplierKey: sid, notes,
    });
    push(row, dryRun ? 'VALID' : 'COMMITTED', notes.join('; '));
  }

  if (!dryRun && toCreate.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        for (const name of newSuppliers) {
          const s = await tx.supplier.create({ data: { name } });
          supplierId.set(name.toLowerCase(), s.id);
        }
        for (const item of toCreate) {
          const p = await tx.product.create({ data: { ...item.data, supplierId: item.supplierKey ? supplierId.get(item.supplierKey) : null } });
        }
      },
      { timeout: 120000, maxWait: 10000 }
    );
  }

  results.sort((a, b) => a.row - b.row);
  const count = (o) => results.filter((r) => r.outcome === o).length;
  return {
    dryRun,
    total: results.length,
    committed: count('COMMITTED'),
    valid: count('VALID'),
    errors: count('ERROR'),
    duplicates: count('DUPLICATE'),
    results,
  };
}

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function sampleCsv() {
  const lines = [COLUMNS.join(',')];
  for (const r of SAMPLE_ROWS) lines.push(COLUMNS.map((c) => csvCell(r[c] ?? '')).join(','));
  return lines.join('\r\n') + '\r\n';
}

module.exports = { importProducts, sampleCsv, COLUMNS, MAX_ROWS };
