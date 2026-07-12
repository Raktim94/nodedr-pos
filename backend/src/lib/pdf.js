// Renders a receipt as a PDF buffer with pdfkit — a pure-JS PDF generator
// (no native bindings, no shell-out), so this ships with zero extra CVEs.
// Used for the "Download PDF" button; the same data also feeds the printable
// HTML view (see receipt.js) that drives the browser print dialog.
const PDFDocument = require('pdfkit');

function money(sym, n) {
  return `${sym} ${Number(n).toFixed(2)}`;
}

// A drawn horizontal rule spanning the content width. Earlier this used
// repeated '-'/'=' characters via doc.text(), but at this page width that
// wraps onto multiple lines instead of drawing a single separator.
function rule(doc, { dashed = false } = {}) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.y + 2;
  doc.save();
  if (dashed) doc.dash(2, { space: 2 });
  doc.lineWidth(dashed ? 0.75 : 1.25).moveTo(left, y).lineTo(right, y).stroke('#000');
  doc.restore();
  doc.y = y + 6;
}

function buildReceiptPdf({ shop, invoice }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [227, 700], margin: 16 }); // ~80mm wide, tall enough for most bills
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const sym = shop.currencySymbol || 'Rs.';
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.font('Helvetica-Bold').fontSize(13).text(shop.shopName, { align: 'center' });
    doc.font('Helvetica').fontSize(8);
    if (shop.legalName) doc.text(shop.legalName, { align: 'center' });
    const addr = [shop.address1, shop.address2].filter(Boolean).join(', ');
    if (addr) doc.text(addr, { align: 'center' });
    const cityState = [shop.city, shop.state].filter(Boolean).join(', ');
    if (cityState) doc.text(cityState, { align: 'center' });
    if (shop.phone) doc.text(`Ph: ${shop.phone}`, { align: 'center' });
    if (shop.gstEnabled && shop.gstNumber) doc.text(`GSTIN: ${shop.gstNumber}`, { align: 'center' });

    doc.moveDown(0.5);
    rule(doc, { dashed: true });
    const date = new Date(invoice.createdAt || Date.now());
    doc.text(`${date.toLocaleString()}`);
    doc.text(`Bill: #${invoice.invoiceNumber}`);
    doc.text(`Cust: ${invoice.customerName || 'Walk-in Customer'}${invoice.customerPhone ? ` · ${invoice.customerPhone}` : ''}`);
    rule(doc, { dashed: true });

    const colName = width * 0.28;
    const colQty = width * 0.22; // wide enough for "<qty> <unit>", e.g. "3 KGS"
    const colRate = width * 0.25;
    const colAmt = width * 0.25;
    // Right-aligned columns sit flush against each other's shared boundary,
    // so a value that nearly fills its column touches the next one with no
    // gap — shave a few points off each non-final right-aligned column's
    // text-box width (not its position) to leave visible breathing room.
    const GAP = 4;
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(7.5);
    doc.text('Item', doc.page.margins.left, y, { width: colName });
    doc.text('Qty', doc.page.margins.left + colName, y, { width: colQty - GAP, align: 'right' });
    doc.text('Rate', doc.page.margins.left + colName + colQty, y, { width: colRate - GAP, align: 'right' });
    doc.text('Amount', doc.page.margins.left + colName + colQty + colRate, y, { width: colAmt, align: 'right' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8);
    rule(doc, { dashed: true });

    for (const it of invoice.items) {
      y = doc.y;
      const base = it.price * it.quantity;
      doc.text(it.name, doc.page.margins.left, y, { width: colName });
      const rowHeight = doc.heightOfString(it.name, { width: colName });
      doc.text(it.unit ? `${it.quantity} ${it.unit}` : String(it.quantity), doc.page.margins.left + colName, y, {
        width: colQty - GAP,
        align: 'right',
      });
      doc.text(money(sym, it.price), doc.page.margins.left + colName + colQty, y, { width: colRate - GAP, align: 'right' });
      doc.text(money(sym, base), doc.page.margins.left + colName + colQty + colRate, y, { width: colAmt, align: 'right' });
      doc.y = y + Math.max(rowHeight, 11);
      if (shop.gstEnabled && shop.showGst && it.taxRate > 0) {
        doc.fontSize(6.5).fillColor('#666').text(`  GST @ ${it.taxRate}%`);
        doc.fontSize(8).fillColor('#000');
      }
    }

    rule(doc, { dashed: true });

    const totalLine = (label, value, bold = false) => {
      const yy = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5);
      doc.text(label, doc.page.margins.left, yy, { width: width * 0.6 });
      doc.text(value, doc.page.margins.left + width * 0.6, yy, { width: width * 0.4, align: 'right' });
      doc.font('Helvetica').fontSize(8);
    };

    totalLine('Subtotal', money(sym, invoice.subtotal));
    if (invoice.discountAmount > 0) {
      const label = invoice.discountType === 'percent' ? `Discount (${invoice.discountValue}%)` : 'Discount';
      totalLine(label, `- ${money(sym, invoice.discountAmount)}`);
    }
    if (shop.gstEnabled && invoice.taxAmount > 0) {
      const half = Math.round((invoice.taxAmount / 2 + Number.EPSILON) * 100) / 100;
      totalLine('CGST', money(sym, half));
      totalLine('SGST', money(sym, invoice.taxAmount - half));
    }
    if (invoice.loyaltyDiscount > 0) {
      totalLine(`Loyalty (${invoice.pointsRedeemed} pts)`, `- ${money(sym, invoice.loyaltyDiscount)}`);
    }
    rule(doc);
    totalLine('GRAND TOTAL', money(sym, invoice.totalAmount), true);
    rule(doc);
    totalLine(`Paid (${invoice.paymentMethod})`, money(sym, invoice.amountPaid));
    if (invoice.changeDue > 0) totalLine('Change', money(sym, invoice.changeDue));

    if (shop.loyaltyEnabled && invoice.pointsEarned > 0) {
      doc.moveDown(0.3);
      doc.fontSize(8).text(`You earned ${invoice.pointsEarned} loyalty points!`, { align: 'center' });
    }

    doc.moveDown(0.5);
    rule(doc, { dashed: true });
    doc.fontSize(8).text(shop.receiptFooter || 'Thank You! Visit Again.', { align: 'center' });

    doc.end();
  });
}

module.exports = { buildReceiptPdf };
