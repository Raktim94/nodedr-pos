// Text formatting shared by receipts, invoices, PDFs and e-mailed reports.

// Amount with the shop's currency symbol in front, always two decimals.
const formatMoney = (symbol, amount) => `${symbol} ${Number(amount).toFixed(2)}`;

// Escapes text for HTML (receipts, e-mail bodies).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = { formatMoney, esc };
