// A4 tax invoice PDF (pdfkit). Layout follows nodedr-invoice's invoice
// document: business + bill-to header, itemised table, tax breakup, payment
// QR, serial/warranty table, terms and signature blocks.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { readSignature } = require('./signatures');
const { buildUpiUri } = require('./upi');

const GREEN = '#0d3b28';
const MUTED = '#66746b';
const LINE = '#dfe6df';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below100(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`; }
function below1000(n) { return n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + below100(n % 100) : ''}` : below100(n); }
// Indian numbering (lakh / crore) — used for the "Amount in words" line.
function amountInWords(amount) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero Only';
  const parts = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  let out = parts.join(' ');
  if (paise) out += `${out ? ' and ' : ''}${below100(paise)} Paise`;
  return `${out} Only`;
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

async function buildInvoicePdf({ shop, invoice }) {
  const sym = shop.currencySymbol || 'Rs.';
  // Core fonts have no ₹ glyph; the app's symbol for INR is already "Rs.".
  const money = (n) => `${sym} ${Number(n).toFixed(2)}`;

  let qrPng = null;
  const balance = Math.max(0, invoice.dueAmount || 0);
  if (shop.upiId && shop.currencyCode === 'INR' && balance > 0) {
    qrPng = await QRCode.toBuffer(
      buildUpiUri({ vpa: shop.upiId, name: shop.shopName, amount: balance, note: invoice.invoiceNumber, ref: invoice.invoiceNumber }),
      { type: 'png', margin: 1, width: 220, errorCorrectionLevel: 'M' }
    );
  }
  const shopSig = readSignature(shop.signatureFile);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${invoice.invoiceNumber}`, Author: shop.shopName } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = doc.page.margins.left;
    const R = doc.page.width - doc.page.margins.right;
    const W = R - L;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 20;

    // ---- header ----
    doc.font('Helvetica-Bold').fontSize(18).fillColor(GREEN).text(shop.shopName, L, 40, { width: W * 0.6 });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    if (shop.legalName) doc.text(shop.legalName, { width: W * 0.6 });
    const addr = [shop.address1, shop.address2, shop.city, shop.state, shop.pincode].filter(Boolean).join(', ');
    if (addr) doc.text(addr, { width: W * 0.6 });
    const contact = [shop.phone && `Ph: ${shop.phone}`, shop.email].filter(Boolean).join('  |  ');
    if (contact) doc.text(contact, { width: W * 0.6 });
    if (shop.gstEnabled && shop.gstNumber) doc.text(`GSTIN: ${shop.gstNumber}`, { width: W * 0.6 });
    if (shop.panNumber) doc.text(`PAN: ${shop.panNumber}`, { width: W * 0.6 });
    const leftEnd = doc.y;

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#17251d').text(shop.gstEnabled ? 'TAX INVOICE' : 'INVOICE', L + W * 0.6, 40, { width: W * 0.4, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(`No: ${invoice.invoiceNumber}`, L + W * 0.6, 66, { width: W * 0.4, align: 'right' });
    doc.text(`Date: ${fmtDate(invoice.createdAt || Date.now())}`, { width: W * 0.4, align: 'right', continued: false });
    doc.text(`Payment: ${invoice.paymentMethod}`, L + W * 0.6, doc.y, { width: W * 0.4, align: 'right' });

    let y = Math.max(leftEnd, doc.y) + 14;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(LINE).stroke();
    y += 10;

    // ---- bill to ----
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('BILL TO', L, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#17251d').text(invoice.customerName || 'Walk-in Customer', L, y + 12);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    if (invoice.customerPhone) doc.text(`Ph: ${invoice.customerPhone}`, L);
    y = doc.y + 14;

    // ---- items table ----
    const cols = [
      { k: 'n', label: '#', w: 22, align: 'left' },
      { k: 'name', label: 'Item', w: W - 22 - 62 - 48 - 70 - 48 - 80, align: 'left' },
      { k: 'hsn', label: 'HSN', w: 62, align: 'left' },
      { k: 'qty', label: 'Qty', w: 48, align: 'right' },
      { k: 'rate', label: 'Rate', w: 70, align: 'right' },
      { k: 'gst', label: 'GST', w: 48, align: 'right' },
      { k: 'amt', label: 'Amount', w: 80, align: 'right' },
    ];
    const drawHeader = (yy) => {
      doc.rect(L, yy, W, 20).fill(GREEN);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
      let x = L;
      for (const c of cols) {
        doc.text(c.label, x + 4, yy + 6, { width: c.w - 8, align: c.align });
        x += c.w;
      }
      return yy + 20;
    };
    y = drawHeader(y);

    invoice.items.forEach((it, i) => {
      const serialText = it.serials?.length ? `S/N: ${it.serials.map((s) => s.serial).join(', ')}` : '';
      doc.font('Helvetica-Bold').fontSize(9);
      const nameH = doc.heightOfString(it.name, { width: cols[1].w - 8 });
      doc.font('Helvetica').fontSize(7.5);
      const serH = serialText ? doc.heightOfString(serialText, { width: cols[1].w - 8 }) : 0;
      const rowH = Math.max(nameH + serH + 10, 22);
      if (y + rowH > bottomLimit() - 160) {
        doc.addPage();
        y = drawHeader(doc.page.margins.top);
      }
      const cells = {
        n: String(i + 1),
        hsn: it.product?.hsn || '',
        qty: `${it.quantity}${it.unit ? ' ' + it.unit : ''}`,
        rate: money(it.price),
        gst: it.taxRate > 0 ? `${it.taxRate}%` : '-',
        amt: money(it.total),
      };
      let x = L;
      for (const c of cols) {
        if (c.k === 'name') {
          doc.font('Helvetica-Bold').fontSize(9).fillColor('#17251d').text(it.name, x + 4, y + 5, { width: c.w - 8 });
          if (serialText) doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(serialText, x + 4, doc.y, { width: c.w - 8 });
        } else {
          doc.font('Helvetica').fontSize(9).fillColor('#17251d').text(cells[c.k], x + 4, y + 5, { width: c.w - 8, align: c.align });
        }
        x += c.w;
      }
      y += rowH;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });

    // ---- totals (right) + payment QR / words (left) ----
    y += 12;
    if (y > bottomLimit() - 150) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    const totalsX = L + W * 0.55;
    const totalsW = W * 0.45;
    let ty = y;
    const trow = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? GREEN : '#17251d');
      doc.text(label, totalsX, ty, { width: totalsW * 0.55 });
      doc.text(value, totalsX + totalsW * 0.45, ty, { width: totalsW * 0.55, align: 'right' });
      ty += bold ? 18 : 14;
    };
    trow('Subtotal', money(invoice.subtotal));
    if (invoice.discountAmount > 0) trow(invoice.discountType === 'percent' ? `Discount (${invoice.discountValue}%)` : 'Discount', `- ${money(invoice.discountAmount)}`);
    if (shop.gstEnabled && invoice.taxAmount > 0) {
      const half = Math.round((invoice.taxAmount / 2 + Number.EPSILON) * 100) / 100;
      trow('CGST (incl.)', money(half));
      trow('SGST (incl.)', money(invoice.taxAmount - half));
    }
    if (invoice.loyaltyDiscount > 0) trow(`Loyalty (${invoice.pointsRedeemed} pts)`, `- ${money(invoice.loyaltyDiscount)}`);
    if (invoice.returnValue > 0) trow('Returns', `- ${money(invoice.returnValue)}`);
    if (invoice.creditApplied > 0) trow('Store credit used', `- ${money(invoice.creditApplied)}`);
    const payable = Math.max(0, Math.round((invoice.totalAmount - invoice.returnValue - invoice.creditApplied) * 100) / 100);
    doc.moveTo(totalsX, ty).lineTo(R, ty).lineWidth(1).strokeColor(GREEN).stroke();
    ty += 5;
    trow(invoice.returnValue > 0 || invoice.creditApplied > 0 ? 'NET PAYABLE' : 'GRAND TOTAL', money(payable), true);
    trow(`Paid (${invoice.paymentMethod})`, money(invoice.amountPaid));
    if (invoice.changeDue > 0) trow('Change', money(invoice.changeDue));
    if (invoice.dueAmount > 0) trow('Balance due', money(invoice.dueAmount), true);

    // left column beside totals
    let ly = y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('AMOUNT IN WORDS', L, ly);
    doc.font('Helvetica').fontSize(9).fillColor('#17251d').text(`${sym === 'Rs.' ? 'Rupees' : shop.currencyCode} ${amountInWords(payable)}`, L, ly + 11, { width: W * 0.5 });
    ly = doc.y + 8;
    if (qrPng) {
      doc.image(qrPng, L, ly, { width: 76 });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN).text('Scan to pay balance', L + 84, ly + 20, { width: 120 });
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${shop.upiId}`, L + 84, doc.y, { width: 120 });
      ly += 82;
    }
    y = Math.max(ty, ly) + 10;

    // ---- warranty table ----
    const serialRows = invoice.items.flatMap((it) => (it.serials || []).map((s) => ({ name: it.name, serial: s.serial, ends: s.warrantyEndsAt, months: it.warrantyMonths })));
    if (serialRows.length > 0) {
      const need = 24 + serialRows.length * 14;
      if (y + need > bottomLimit() - 70) { doc.addPage(); y = doc.page.margins.top; }
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('WARRANTY / SERIAL NUMBERS', L, y);
      y += 12;
      for (const r of serialRows) {
        if (y > bottomLimit() - 70) { doc.addPage(); y = doc.page.margins.top; }
        doc.font('Helvetica').fontSize(8.5).fillColor('#17251d').text(r.name, L, y, { width: W * 0.38, lineBreak: false, ellipsis: true });
        doc.font('Courier').text(r.serial, L + W * 0.4, y, { width: W * 0.25, lineBreak: false });
        doc.font('Helvetica').text(r.ends ? `Warranty until ${fmtDate(r.ends)} (${r.months} mo)` : 'No warranty', L + W * 0.66, y, { width: W * 0.34, lineBreak: false });
        y += 14;
      }
      y += 6;
    }

    // ---- terms + authorised signature ----
    // The signature block is a fixed 74pt-tall unit. If it will not fit under
    // the content, it moves to a new page as a whole (never split, never
    // spilling a lone label onto a blank page); otherwise it sits at the
    // bottom of the current page. Text inside it is single-line + clipped so
    // it can never wrap past the page margin and trigger an extra page.
    const SIG_H = 74;
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    const termsText = shop.termsText || shop.receiptFooter || '';
    let termsH = 0;
    if (termsText) {
      doc.font('Helvetica').fontSize(8);
      termsH = 12 + Math.min(doc.heightOfString(termsText, { width: W * 0.55 }), 60);
    }
    if (y + Math.max(termsH, SIG_H) > pageBottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    if (termsText) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('TERMS', L, y, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(termsText, L, y + 11, { width: W * 0.55, height: 60, ellipsis: true });
    }
    const sigW = 150;
    const sigX = R - sigW;
    const sigY = Math.max(y, pageBottom - SIG_H);
    if (shopSig) {
      try {
        // Scaled to fit the box and centred in it, so a tall or wide image can't overflow.
        doc.image(shopSig, sigX, sigY, { fit: [sigW, 40], align: 'center', valign: 'bottom' });
      } catch {
        /* unreadable image — leave the space blank */
      }
    }
    doc.moveTo(sigX, sigY + 44).lineTo(sigX + sigW, sigY + 44).lineWidth(0.75).strokeColor(MUTED).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text('Authorised signatory', sigX + (sigW - doc.widthOfString('Authorised signatory')) / 2, sigY + 48, { lineBreak: false });
    if (shop.signatoryName) {
      // Clip by measuring (not pdfkit's own ellipsis, which can wrap onto a new
      // page when a long name sits at the page foot).
      let name = shop.signatoryName;
      while (name.length > 1 && doc.widthOfString(name) > sigW) name = name.slice(0, -2).trimEnd() + (name.endsWith('…') ? '' : '…');
      doc.text(name, sigX + (sigW - doc.widthOfString(name)) / 2, sigY + 59, { lineBreak: false });
    }

    doc.end();
  });
}

module.exports = { buildInvoicePdf, amountInWords };
