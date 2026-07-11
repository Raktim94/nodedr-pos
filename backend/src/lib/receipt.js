// Builds the plain-text receipt body used both for raw ESC/POS printing
// and as a preview string returned to the frontend.
//
// Column layout is computed for a given character width so it lines up on
// both 58mm (32 cols) and 80mm (48 cols) paper — pass `width` accordingly.

function pad(str, len) {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function padLeft(str, len) {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : ' '.repeat(len - str.length) + str;
}

function centerLine(str, width) {
  str = String(str);
  if (str.length >= width) return str.slice(0, width);
  const left = Math.floor((width - str.length) / 2);
  return ' '.repeat(left) + str;
}

function formatMoney(n) {
  return Number(n).toFixed(2);
}

function buildReceiptText({ shop, invoice, width = 48 }) {
  const line = '='.repeat(width);
  const thin = '-'.repeat(width);

  // Item table columns: Name | Qty | Price | Total
  const qtyW = 5;
  const priceW = 8;
  const totalW = 8;
  const nameW = width - qtyW - priceW - totalW;

  const rows = invoice.items.map((item) => {
    const name = pad(item.name, nameW);
    const qty = padLeft(item.quantity, qtyW);
    const price = padLeft(formatMoney(item.price), priceW);
    const total = padLeft(formatMoney(item.total), totalW);
    return `${name}${qty}${price}${total}`;
  });

  const dateStr = new Date(invoice.createdAt || Date.now()).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).replace(/\//g, '-');

  const billLine = `Date: ${dateStr}`;
  const invLine = `Bill: #${invoice.invoiceNumber}`;
  const gap = Math.max(1, width - billLine.length - invLine.length);

  const grandTotalLabel = 'GRAND TOTAL:';
  const grandTotalValue = `${shop.currency} ${formatMoney(invoice.totalAmount)}`;
  const gtGap = Math.max(1, width - grandTotalLabel.length - grandTotalValue.length);

  const out = [];
  out.push(line);
  out.push(centerLine(shop.shopName, width));
  out.push(centerLine(shop.address1, width));
  if (shop.address2) out.push(centerLine(shop.address2, width));
  out.push(line);
  out.push(`${billLine}${' '.repeat(gap)}${invLine}`);
  out.push(`Cust: ${invoice.customerName || 'Walk-in Customer'}`);
  out.push(thin);
  out.push(`${pad('Item Name', nameW)}${padLeft('Qty', qtyW)}${padLeft('Price', priceW)}${padLeft('Total', totalW)}`);
  out.push(thin);
  out.push(...rows);
  out.push(thin);
  out.push(`${grandTotalLabel}${' '.repeat(gtGap)}${grandTotalValue}`);
  out.push(line);
  out.push(centerLine('Payment: CASH / UPI Static QR', width));
  out.push(centerLine('Thank You! Visit Again.', width));
  out.push(line);

  return out.join('\n');
}

module.exports = { buildReceiptText, formatMoney };
