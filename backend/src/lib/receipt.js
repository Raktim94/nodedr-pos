// Builds the printable HTML receipt (see buildReceiptHtml below), shared by
// the browser print flow and used as the content reference for the PDF
// renderer in pdf.js.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Builds a standalone, self-printing HTML receipt. Loaded into a hidden
// same-page iframe (see frontend/lib/print.ts) rather than a new tab, it
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
    // Prices are MRP — GST-inclusive by law — so these are a breakup of
    // tax already inside the total above, not additional charges. Labelled
    // "(incl.)" so the receipt doesn't read as if they should be added.
    const half = Math.round((invoice.taxAmount / 2 + Number.EPSILON) * 100) / 100;
    totalRows.push(['CGST (incl.)', money(half)]);
    totalRows.push(['SGST (incl.)', money(invoice.taxAmount - half)]);
  }
  if (invoice.loyaltyDiscount > 0) {
    totalRows.push([`Loyalty (${invoice.pointsRedeemed} pts)`, `- ${money(invoice.loyaltyDiscount)}`]);
  }
  if (invoice.returnValue > 0) totalRows.push(['Returns', `- ${money(invoice.returnValue)}`]);
  if (invoice.creditApplied > 0) totalRows.push(['Store credit used', `- ${money(invoice.creditApplied)}`]);

  // With returns/credit, the customer pays (or is refunded) the net, not the
  // raw sale total. Decide the bold bottom line accordingly.
  const payable = Math.max(0, Math.round((invoice.totalAmount - invoice.returnValue - invoice.creditApplied) * 100) / 100);
  const hasRefund = invoice.refundValue > 0;
  const grandLabel = hasRefund
    ? `REFUND (${invoice.refundMode === 'CREDIT' ? 'store credit' : 'cash'})`
    : invoice.returnValue > 0 || invoice.creditApplied > 0
      ? 'NET PAYABLE'
      : 'GRAND TOTAL';
  const grandValue = hasRefund ? invoice.refundValue : payable;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(invoice.invoiceNumber)}</title>
<style>
  /* Kept deliberately tight: every extra pixel of vertical whitespace here
     is real thermal paper on every single receipt printed, forever. */
  * { box-sizing: border-box; }
  /* THE fix for right-side clipping. The sheet is an 80mm thermal roll.
     Getting the geometry consistent is everything: the page box, the body,
     and the content must all agree, or whatever is widest overflows and the
     printer chops it off on the right.
       - @page margin 0: the page box is the FULL 80mm. (A non-zero @page
         margin shrinks the page box below 80mm, and then an 80mm-wide body
         no longer fits — that mismatch was the bug.)
       - body is exactly 80mm with box-sizing border-box, so its 4mm padding
         is subtracted FROM the 80mm, not added to it. Content is therefore
         72mm wide and sits 4mm inside each physical edge — comfortably clear
         of the small non-printable strip every thermal head has. Nothing on
         the page is ever wider than the 80mm sheet, so nothing clips. */
  html { margin: 0; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0 auto; padding: 4mm; color: #111; width: 80mm; }
  p { margin: 0 0 3px; }
  .receipt { width: 100%; margin: 0; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
  .center { text-align: center; }
  .muted { color: #555; font-size: 11px; line-height: 1.35; }
  .rule { border: none; border-top: 1px dashed #999; margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #777; padding-bottom: 2px; }
  td { padding: 1px 0; vertical-align: top; word-break: break-word; }
  .num { text-align: right; white-space: nowrap; padding-left: 6px; }
  .sub { font-size: 10px; color: #777; }
  .totals td { padding: 1px 0; }
  .grand td { font-weight: 700; font-size: 13px; border-top: 1px solid #111; padding-top: 3px; }
  .footer { text-align: center; margin-top: 6px; font-size: 11px; }
  @page { size: 80mm auto; margin: 0; }
  @media print {
    html, body { width: 80mm; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <script>
    // The parent frame (frontend/lib/print.ts) normally calls print() on this
    // window directly after focusing it. This is only a fallback for engines
    // that block the cross-frame call: the parent posts "print" and we run it.
    window.addEventListener('message', function (e) { if (e.data === 'print') window.print(); });
  </script>
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
      <tr class="grand"><td>${esc(grandLabel)}</td><td class="num">${money(grandValue)}</td></tr>
    </table>
    ${
      hasRefund
        ? ''
        : `<hr class="rule">
    <table class="totals">
      <tr><td>Paid (${esc(invoice.paymentMethod)})</td><td class="num">${money(invoice.amountPaid)}</td></tr>
      ${
        invoice.previousDuePaid > 0
          ? `<tr><td>Old Due Cleared</td><td class="num">${money(invoice.previousDuePaid)}</td></tr>
      <tr class="grand"><td>Total Collected</td><td class="num">${money(invoice.amountPaid + invoice.previousDuePaid)}</td></tr>`
          : ''
      }
      ${invoice.changeDue > 0 ? `<tr><td>Change</td><td class="num">${money(invoice.changeDue)}</td></tr>` : ''}
      ${invoice.dueAmount > 0 ? `<tr><td>Balance Due</td><td class="num">${money(invoice.dueAmount)}</td></tr>` : ''}
    </table>`
    }
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
