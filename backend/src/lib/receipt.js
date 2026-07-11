// Builds the plain-text receipt body for ESC/POS printing and as a preview
// string for the UI. Column widths are computed for the given character
// width so amounts right-align on both 58mm (32 cols) and 80mm (48 cols).

function pad(str, len) {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}
function padLeft(str, len) {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : ' '.repeat(len - str.length) + str;
}
function center(str, width) {
  str = String(str);
  if (str.length >= width) return str.slice(0, width);
  const left = Math.floor((width - str.length) / 2);
  return ' '.repeat(left) + str;
}
function money(n) {
  return Number(n).toFixed(2);
}

function buildReceiptText({ shop, invoice, width = 48 }) {
  const line = '='.repeat(width);
  const thin = '-'.repeat(width);
  const sym = shop.currencySymbol || 'Rs.';

  // Item columns: Name | Qty | Rate | Amount
  const qtyW = 4;
  const rateW = 9;
  const amtW = 10;
  const nameW = width - qtyW - rateW - amtW;

  const out = [];
  const push = (s = '') => out.push(s);

  // --- Header ---
  push(line);
  if (shop.receiptHeader) {
    shop.receiptHeader.split('\n').forEach((l) => push(center(l, width)));
  }
  push(center(shop.shopName, width));
  if (shop.legalName) push(center(shop.legalName, width));
  push(center(shop.address1, width));
  if (shop.address2) push(center(shop.address2, width));
  const cityState = [shop.city, shop.state].filter(Boolean).join(', ');
  if (cityState) push(center(cityState, width));
  if (shop.phone) push(center(`Ph: ${shop.phone}`, width));
  if (shop.gstEnabled && shop.gstNumber) push(center(`GSTIN: ${shop.gstNumber}`, width));
  push(line);

  // --- Meta ---
  const date = new Date(invoice.createdAt || Date.now());
  const dateStr = date.toLocaleDateString('en-GB').replace(/\//g, '-');
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const leftMeta = `Date: ${dateStr} ${timeStr}`;
  const rightMeta = `Bill: #${invoice.invoiceNumber}`;
  const gap = Math.max(1, width - leftMeta.length - rightMeta.length);
  push(`${leftMeta}${' '.repeat(gap)}${rightMeta}`);
  push(`Cust: ${invoice.customerName || 'Walk-in Customer'}`);
  if (invoice.customerPhone) push(`Ph:   ${invoice.customerPhone}`);
  push(thin);

  // --- Items ---
  push(`${pad('Item', nameW)}${padLeft('Qty', qtyW)}${padLeft('Rate', rateW)}${padLeft('Amount', amtW)}`);
  push(thin);
  for (const it of invoice.items) {
    const base = it.price * it.quantity;
    push(`${pad(it.name, nameW)}${padLeft(it.quantity, qtyW)}${padLeft(money(it.price), rateW)}${padLeft(money(base), amtW)}`);
    if (shop.gstEnabled && shop.showGst && it.taxRate > 0) {
      push(`  GST @ ${it.taxRate}%`);
    }
  }
  push(thin);

  // --- Totals ---
  const totalLine = (label, value) => {
    const v = `${sym} ${money(value)}`;
    const g = Math.max(1, width - label.length - v.length);
    push(`${label}${' '.repeat(g)}${v}`);
  };

  totalLine('Subtotal', invoice.subtotal);
  if (invoice.discountAmount > 0) {
    const label = invoice.discountType === 'percent' ? `Discount (${invoice.discountValue}%)` : 'Discount';
    totalLine(label, -invoice.discountAmount);
  }
  if (shop.gstEnabled && invoice.taxAmount > 0) {
    // Split into CGST + SGST (intra-state) — each half the total tax.
    const half = Math.round((invoice.taxAmount / 2 + Number.EPSILON) * 100) / 100;
    totalLine('CGST', half);
    totalLine('SGST', money(invoice.taxAmount - half));
  }
  if (invoice.loyaltyDiscount > 0) {
    totalLine(`Loyalty (${invoice.pointsRedeemed} pts)`, -invoice.loyaltyDiscount);
  }
  push(line);
  totalLine('GRAND TOTAL', invoice.totalAmount);
  push(line);

  totalLine(`Paid (${invoice.paymentMethod})`, invoice.amountPaid);
  if (invoice.changeDue > 0) totalLine('Change', invoice.changeDue);

  // --- Loyalty summary ---
  if (shop.loyaltyEnabled && invoice.pointsEarned > 0) {
    push(thin);
    push(center(`You earned ${invoice.pointsEarned} loyalty points!`, width));
  }

  push(line);
  (shop.receiptFooter || 'Thank You! Visit Again.').split('\n').forEach((l) => push(center(l, width)));
  push(line);

  return out.join('\n');
}

module.exports = { buildReceiptText };
