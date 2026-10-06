// Reporting queries. Aggregations that don't depend on timezone run in SQL;
// day / hour bucketing is done in JS in the till's local timezone (stored
// timestamps are UTC), over narrow selected columns only.
const prisma = require('./prisma');
const { round2 } = require('./pricing');

const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// Local-midnight bounds from YYYY-MM-DD strings; `to` is inclusive.
function parseRange(from, to, defaultDays = 30) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const end = to && re.test(to) ? new Date(`${to}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
  end.setDate(end.getDate() + 1); // exclusive upper bound
  let start;
  if (from && re.test(from)) start = new Date(`${from}T00:00:00`);
  else {
    start = new Date(end);
    start.setDate(start.getDate() - defaultDays);
  }
  if (!(start < end)) throw Object.assign(new Error('"from" must be before "to"'), { status: 400 });
  if ((end - start) / 86400000 > 800) throw Object.assign(new Error('Range too large (max ~2 years)'), { status: 400 });
  return { start, end };
}

async function totalsFor(start, end) {
  const [inv] = await prisma.$queryRaw`
    SELECT COUNT(*) AS bills, COALESCE(SUM(totalAmount),0) AS revenue, COALESCE(SUM(taxAmount),0) AS tax,
           COALESCE(SUM(returnValue),0) AS returns, COALESCE(SUM(discountAmount),0) AS discounts
    FROM Invoice WHERE createdAt >= ${start} AND createdAt < ${end}`;
  const [cost] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(ii.costPrice * ii.quantity),0) AS cost, COALESCE(SUM(ii.total - ii.taxAmount),0) AS net
    FROM InvoiceItem ii JOIN Invoice i ON i.id = ii.invoiceId
    WHERE i.createdAt >= ${start} AND i.createdAt < ${end}`;
  const bills = Number(inv.bills);
  const revenue = round2(Number(inv.revenue));
  const netSales = round2(Number(cost.net));
  const costV = round2(Number(cost.cost));
  const grossProfit = round2(netSales - costV);
  return {
    bills,
    revenue,
    tax: round2(Number(inv.tax)),
    returns: round2(Number(inv.returns)),
    discounts: round2(Number(inv.discounts)),
    netSales,
    cost: costV,
    grossProfit,
    marginPct: netSales > 0 ? round2((grossProfit / netSales) * 100) : 0,
    avgBill: bills > 0 ? round2(revenue / bills) : 0,
  };
}

const delta = (cur, prev) => (prev > 0 ? round2(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0);

async function overview(from, to) {
  const { start, end } = parseRange(from, to);
  const span = end - start;
  const prevStart = new Date(start.getTime() - span);
  const [totals, previous, invoices, categories, products] = await Promise.all([
    totalsFor(start, end),
    totalsFor(prevStart, start),
    prisma.invoice.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { createdAt: true, totalAmount: true } }),
    prisma.$queryRaw`
      SELECT COALESCE(p.category,'Uncategorised') AS category, SUM(ii.quantity) AS qty,
             SUM(ii.total - ii.taxAmount) AS net, SUM(ii.costPrice * ii.quantity) AS cost
      FROM InvoiceItem ii JOIN Invoice i ON i.id = ii.invoiceId JOIN Product p ON p.id = ii.productId
      WHERE i.createdAt >= ${start} AND i.createdAt < ${end}
      GROUP BY COALESCE(p.category,'Uncategorised') ORDER BY net DESC`,
    prisma.$queryRaw`
      SELECT ii.productId AS id, ii.name AS name, SUM(ii.quantity) AS qty,
             SUM(ii.total - ii.taxAmount) AS net, SUM(ii.costPrice * ii.quantity) AS cost
      FROM InvoiceItem ii JOIN Invoice i ON i.id = ii.invoiceId
      WHERE i.createdAt >= ${start} AND i.createdAt < ${end}
      GROUP BY ii.productId, ii.name ORDER BY net DESC LIMIT 15`,
  ]);

  // daily series (zero-filled) + hour x weekday heatmap, local time
  const daily = new Map();
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) daily.set(dayKey(d), { date: dayKey(d), revenue: 0, bills: 0 });
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ bills: 0, revenue: 0 })));
  for (const i of invoices) {
    const b = daily.get(dayKey(i.createdAt));
    if (b) {
      b.revenue = round2(b.revenue + i.totalAmount);
      b.bills += 1;
    }
    const d = new Date(i.createdAt);
    const cell = heat[d.getDay()][d.getHours()];
    cell.bills += 1;
    cell.revenue = round2(cell.revenue + i.totalAmount);
  }
  const shape = (r) => {
    const net = round2(Number(r.net));
    const cost = round2(Number(r.cost));
    const profit = round2(net - cost);
    return { ...r, qty: Number(r.qty), net, cost, profit, marginPct: net > 0 ? round2((profit / net) * 100) : 0 };
  };
  return {
    range: { from: dayKey(start), to: dayKey(new Date(end.getTime() - 1)) },
    totals,
    previous,
    deltas: {
      revenue: delta(totals.revenue, previous.revenue),
      grossProfit: delta(totals.grossProfit, previous.grossProfit),
      bills: delta(totals.bills, previous.bills),
      avgBill: delta(totals.avgBill, previous.avgBill),
    },
    daily: [...daily.values()],
    heatmap: heat, // [weekday 0=Sun][hour]
    categories: categories.map(shape),
    topProducts: products.map(shape),
  };
}

// today vs yesterday / this week vs last / this month vs last
async function compare(period) {
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let curStart, prevStart, curEnd;
  if (period === 'day') {
    curStart = sod;
    prevStart = new Date(sod.getTime() - 86400000);
  } else if (period === 'week') {
    curStart = new Date(sod);
    curStart.setDate(sod.getDate() - ((sod.getDay() + 6) % 7)); // Monday
    prevStart = new Date(curStart);
    prevStart.setDate(prevStart.getDate() - 7);
  } else {
    curStart = new Date(now.getFullYear(), now.getMonth(), 1);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }
  curEnd = new Date(sod.getTime() + 86400000);
  // Same elapsed length for a fair like-for-like comparison.
  const elapsed = curEnd - curStart;
  const prevEnd = new Date(prevStart.getTime() + elapsed);
  const [current, previous] = await Promise.all([totalsFor(curStart, curEnd), totalsFor(prevStart, prevEnd)]);
  return {
    period,
    current,
    previous,
    deltas: { revenue: delta(current.revenue, previous.revenue), grossProfit: delta(current.grossProfit, previous.grossProfit), bills: delta(current.bills, previous.bills) },
  };
}

// ---------------- GSTR-1 / tax summary ----------------

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

async function gstr1(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw Object.assign(new Error('month must be YYYY-MM'), { status: 400 });
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const shop = await prisma.shopSettings.findFirst();
  const shopState = shop?.gstNumber?.slice(0, 2) || '';

  const lines = await prisma.$queryRaw`
    SELECT i.id AS invId, i.invoiceNumber, i.createdAt, i.customerName, i.customerGstin, i.totalAmount,
           ii.taxRate, ii.total, ii.taxAmount, ii.quantity, ii.unit, p.hsn AS hsn
    FROM InvoiceItem ii JOIN Invoice i ON i.id = ii.invoiceId JOIN Product p ON p.id = ii.productId
    WHERE i.createdAt >= ${start} AND i.createdAt < ${end} ORDER BY i.id`;

  const b2bMap = new Map();
  const b2csMap = new Map();
  const hsnMap = new Map();
  for (const l of lines) {
    const taxable = round2(Number(l.total) - Number(l.taxAmount));
    const tax = Number(l.taxAmount);
    const rate = Number(l.taxRate);
    const pos = l.customerGstin ? String(l.customerGstin).slice(0, 2) : shopState;
    const inter = shopState && pos && pos !== shopState;
    if (l.customerGstin) {
      const k = `${l.invoiceNumber}|${rate}`;
      const row = b2bMap.get(k) || { gstin: l.customerGstin, receiver: l.customerName, invoiceNumber: l.invoiceNumber, date: dayKey(l.createdAt), invoiceValue: Number(l.totalAmount), placeOfSupply: pos, rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      row.taxable = round2(row.taxable + taxable);
      if (inter) row.igst = round2(row.igst + tax);
      else { row.cgst = round2(row.cgst + tax / 2); row.sgst = round2(row.sgst + tax / 2); }
      b2bMap.set(k, row);
    } else {
      const k = `${pos}|${rate}`;
      const row = b2csMap.get(k) || { type: 'OE', placeOfSupply: pos, rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      row.taxable = round2(row.taxable + taxable);
      row.cgst = round2(row.cgst + tax / 2);
      row.sgst = round2(row.sgst + tax / 2);
      b2csMap.set(k, row);
    }
    const hk = `${l.hsn || ''}|${l.unit || 'OTH'}|${rate}`;
    const h = hsnMap.get(hk) || { hsn: l.hsn || '', uqc: l.unit || 'OTH', rate, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, value: 0 };
    h.qty = round2(h.qty + Number(l.quantity));
    h.taxable = round2(h.taxable + taxable);
    h.value = round2(h.value + Number(l.total));
    if (inter) h.igst = round2(h.igst + tax);
    else { h.cgst = round2(h.cgst + tax / 2); h.sgst = round2(h.sgst + tax / 2); }
    hsnMap.set(hk, h);
  }

  const docs = await prisma.invoice.aggregate({
    where: { createdAt: { gte: start, lt: end } },
    _min: { invoiceNumber: true },
    _max: { invoiceNumber: true },
    _count: true,
  });
  const returns = await prisma.return.findMany({
    where: { createdAt: { gte: start, lt: end } },
    include: { invoice: { select: { invoiceNumber: true, customerGstin: true } } },
  });

  return {
    month,
    gstin: shop?.gstNumber || null,
    b2b: [...b2bMap.values()],
    b2cs: [...b2csMap.values()],
    hsn: [...hsnMap.values()],
    docs: { from: docs._min.invoiceNumber, to: docs._max.invoiceNumber, total: docs._count, cancelled: 0 },
    creditNotes: returns.map((r) => ({ date: dayKey(r.createdAt), originalInvoice: r.invoice.invoiceNumber, gstin: r.invoice.customerGstin, value: round2(r.totalRefund) })),
    notice: 'Prepared from POS data for the GST offline tool / your accountant. Credit notes are listed for adjustment; review before filing.',
  };
}

function gstr1Csv(report, section) {
  const sections = {
    b2b: [['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST'], ...report.b2b.map((r) => [r.gstin, r.receiver, r.invoiceNumber, r.date, r.invoiceValue, r.placeOfSupply, r.rate, r.taxable, r.igst, r.cgst, r.sgst])],
    b2cs: [['Type', 'Place Of Supply', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST'], ...report.b2cs.map((r) => [r.type, r.placeOfSupply, r.rate, r.taxable, r.igst, r.cgst, r.sgst])],
    hsn: [['HSN', 'UQC', 'Total Quantity', 'Total Value', 'Taxable Value', 'Rate', 'IGST', 'CGST', 'SGST'], ...report.hsn.map((r) => [r.hsn, r.uqc, r.qty, r.value, r.taxable, r.rate, r.igst, r.cgst, r.sgst])],
    docs: [['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'], ['Invoices for outward supply', report.docs.from || '', report.docs.to || '', report.docs.total, report.docs.cancelled]],
    cdn: [['Date', 'Original invoice', 'GSTIN', 'Credit note value'], ...report.creditNotes.map((r) => [r.date, r.originalInvoice, r.gstin || '', r.value])],
  };
  if (!sections[section]) throw Object.assign(new Error('section must be b2b, b2cs, hsn, docs or cdn'), { status: 400 });
  return toCsv(sections[section]);
}

// Region-neutral tax summary (VAT / sales tax): taxable value and tax by rate.
async function taxSummaryCsv(from, to) {
  const { start, end } = parseRange(from, to);
  const rows = await prisma.$queryRaw`
    SELECT ii.taxRate AS rate, SUM(ii.total - ii.taxAmount) AS taxable, SUM(ii.taxAmount) AS tax, SUM(ii.total) AS gross
    FROM InvoiceItem ii JOIN Invoice i ON i.id = ii.invoiceId
    WHERE i.createdAt >= ${start} AND i.createdAt < ${end} GROUP BY ii.taxRate ORDER BY ii.taxRate`;
  return toCsv([['Tax rate %', 'Taxable value', 'Tax', 'Gross'], ...rows.map((r) => [r.rate, round2(Number(r.taxable)), round2(Number(r.tax)), round2(Number(r.gross))])]);
}

module.exports = { overview, compare, gstr1, gstr1Csv, taxSummaryCsv, totalsFor, parseRange, dayKey };
