// Text formatting shared by receipts, invoices, PDFs and e-mailed reports.

// Amount with the shop's currency symbol in front, always two decimals.
const formatMoney = (symbol, amount) => `${symbol} ${Number(amount).toFixed(2)}`;

// Escapes text for HTML (receipts, e-mail bodies).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One CSV cell. Quotes values containing commas, quotes or newlines, and
// defuses spreadsheet formulas: a text cell starting with = + - @ (or a tab or
// carriage return) gets a leading ' so Excel/Sheets show it instead of running
// it. Real numbers, and strings that are plainly numeric, are left alone.
function csvCell(value) {
  let s = String(value ?? '');
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().,-]+$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { formatMoney, esc, csvCell };
