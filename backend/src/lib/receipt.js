// Builds the printable HTML receipt (see buildReceiptHtml below), shared by
// the browser print flow and used as the content reference for the PDF
// renderer in pdf.js.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Builds a standalone, self-printing HTML receipt. Opened in a new tab, it
// calls window.print() on load — the browser's own print dialog lets the
// user pick any printer (thermal, laser, PDF virtual printer, whatever the
// OS/CUPS has configured) instead of us talking to a USB device directly.
function buildReceiptHtml({ shop, invoice }) {
  const sym = shop.currencySymbol || 'Rs.';
  const money = (n) => `${sym} ${Number(n).toFixed(2)}`;
  const date = new Date(invoice.createdAt || Date.now());
  const dateStr = date.toLocaleString();

  const itemRows = invoice.items
    .map(
      (it) => `
        <tr>
          <td>${esc(it.name)}${
            shop.gstEnabled && shop.showGst && it.taxRate > 0
              ? `<div class="sub">GST @ ${it.taxRate}%</div>`
              : ''
          }</td>
          <td class="num">${it.quantity}${it.unit ? ` ${esc(it.unit)}` : ''}</td>
          <td class="num">${money(it.price)}</td>
          <td class="num">${money(it.price * it.quantity)}</td>
        </tr>`
    )
    .join('');

  const totalRows = [];
  totalRows.push(['Subtotal', money(invoice.subtotal)]);
  if (invoice.discountAmount > 0) {
    const label = invoice.discountType === 'percent' ? `Discount (${invoice.discountValue}%)` : 'Discount';
    totalRows.push([label, `- ${money(invoice.discountAmount)}`]);
  }
  if (shop.gstEnabled && invoice.taxAmount > 0) {
    const half = Math.round((invoice.taxAmount / 2 + Number.EPSILON) * 100) / 100;
    totalRows.push(['CGST', money(half)]);
    totalRows.push(['SGST', money(invoice.taxAmount - half)]);
  }
  if (invoice.loyaltyDiscount > 0) {
    totalRows.push([`Loyalty (${invoice.pointsRedeemed} pts)`, `- ${money(invoice.loyaltyDiscount)}`]);
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(invoice.invoiceNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 16px; color: #111; }
  .receipt { max-width: 340px; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; }
  .center { text-align: center; }
  .muted { color: #555; font-size: 12px; }
  .rule { border: none; border-top: 1px dashed #999; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #777; padding-bottom: 4px; }
  td { padding: 3px 0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .sub { font-size: 10px; color: #777; }
  .totals td { padding: 2px 0; }
  .grand td { font-weight: 700; font-size: 14px; border-top: 1px solid #111; padding-top: 6px; }
  .footer { text-align: center; margin-top: 14px; font-size: 12px; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body onload="window.print()">
  <div class="receipt">
    ${shop.receiptHeader ? `<p class="center muted">${esc(shop.receiptHeader).replace(/\n/g, '<br>')}</p>` : ''}
    <h1>${esc(shop.shopName)}</h1>
    ${shop.legalName ? `<p class="center muted">${esc(shop.legalName)}</p>` : ''}
    <p class="center muted">
      ${esc(shop.address1)}${shop.address2 ? `, ${esc(shop.address2)}` : ''}<br>
      ${[shop.city, shop.state].filter(Boolean).map(esc).join(', ')}
      ${shop.phone ? `<br>Ph: ${esc(shop.phone)}` : ''}
      ${shop.gstEnabled && shop.gstNumber ? `<br>GSTIN: ${esc(shop.gstNumber)}` : ''}
    </p>
    <hr class="rule">
    <p class="muted">
      ${esc(dateStr)}<br>
      Bill: #${esc(invoice.invoiceNumber)}<br>
      Cust: ${esc(invoice.customerName || 'Walk-in Customer')}${invoice.customerPhone ? ` · ${esc(invoice.customerPhone)}` : ''}
    </p>
    <hr class="rule">
    <table>
      <thead>
        <tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <hr class="rule">
    <table class="totals">
      ${totalRows.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="num">${esc(v)}</td></tr>`).join('')}
      <tr class="grand"><td>GRAND TOTAL</td><td class="num">${money(invoice.totalAmount)}</td></tr>
    </table>
    <hr class="rule">
    <table class="totals">
      <tr><td>Paid (${esc(invoice.paymentMethod)})</td><td class="num">${money(invoice.amountPaid)}</td></tr>
      ${invoice.changeDue > 0 ? `<tr><td>Change</td><td class="num">${money(invoice.changeDue)}</td></tr>` : ''}
    </table>
    ${
      shop.loyaltyEnabled && invoice.pointsEarned > 0
        ? `<p class="center muted">You earned ${invoice.pointsEarned} loyalty points!</p>`
        : ''
    }
    <hr class="rule">
    <p class="footer">${esc(shop.receiptFooter || 'Thank You! Visit Again.').replace(/\n/g, '<br>')}</p>
  </div>
</body>
</html>`;
}

module.exports = { buildReceiptHtml };
