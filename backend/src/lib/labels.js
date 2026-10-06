// Product label printing for Zebra / TSC / Dymo-ZPL-mode thermal label
// printers — ZPL II (Zebra) and EPL2 (older Zebra/Eltron, many TSC).
// Any user-controlled text is stripped of ZPL/EPL control characters first
// so a product name can never inject printer commands.
const clean = (s, max) => String(s ?? '').replace(/[\^~"\\\r\n\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function parseSize(size) {
  const m = /^(\d{2,3})x(\d{2,3})$/.exec(size || '');
  const wMm = m ? Number(m[1]) : 50;
  const hMm = m ? Number(m[2]) : 30;
  const dpmm = 8; // 203 dpi
  return { w: Math.min(Math.round(wMm * dpmm), 832), h: Math.min(Math.round(hMm * dpmm), 1200) };
}

const isEan13 = (c) => /^\d{13}$/.test(c);

function buildZpl({ product, symbol, copies = 1, size }) {
  const { w, h } = parseSize(size);
  const code = clean(product.barcode, 40);
  const barcodeCmd = isEan13(code) ? `^BEN,${Math.round(h * 0.32)},Y,N` : `^BCN,${Math.round(h * 0.32)},Y,N,N`;
  return [
    '^XA',
    `^PW${w}`,
    `^LL${h}`,
    '^CI28',
    `^FO16,12^A0N,26,26^FB${w - 32},2,0,L^FD${clean(product.name, 60)}^FS`,
    `^FO16,${Math.round(h * 0.34)}^BY2${barcodeCmd}^FD${code}^FS`,
    `^FO16,${h - 38}^A0N,30,30^FD${clean(symbol, 6)} ${Number(product.sellingPrice).toFixed(2)}^FS`,
    `^PQ${Math.max(1, Math.min(copies, 500))}`,
    '^XZ',
    '',
  ].join('\n');
}

function buildEpl({ product, symbol, copies = 1, size }) {
  const { w, h } = parseSize(size);
  const code = clean(product.barcode, 40);
  return [
    'N',
    `q${w}`,
    `Q${h},24`,
    `A16,10,0,3,1,1,N,"${clean(product.name, 40)}"`,
    `B16,${Math.round(h * 0.3)},0,${isEan13(code) ? 'E30' : '1'},2,5,${Math.round(h * 0.32)},B,"${code}"`,
    `A16,${h - 36},0,4,1,1,N,"${clean(symbol, 6)} ${Number(product.sellingPrice).toFixed(2)}"`,
    `P${Math.max(1, Math.min(copies, 500))}`,
    '',
  ].join('\n');
}

module.exports = { buildZpl, buildEpl, clean };
