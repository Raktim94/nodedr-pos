// Talks directly to a USB thermal receipt printer over raw ESC/POS, as an
// alternative to the browser-print/PDF flow in receipt.js/pdf.js. Uses the
// `usb` package's legacy API (not WebUSB) — pinned to an exact 2.18.0 in
// package.json because `usb`'s 3.x line is a from-scratch Rust rewrite with
// a completely different API surface (no `getDeviceList`), and the escpos
// ecosystem hasn't caught up to it.
//
// No vendor/product ID configuration: this looks for the standard USB
// Printer device class (interface class 7), which virtually every ESC/POS
// thermal printer advertises regardless of manufacturer, so a "generic
// 80mm thermal printer" works without the user ever finding a vendor:product
// ID.
const usb = require('usb');

const PRINTER_INTERFACE_CLASS = 7;

class PrinterNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrinterNotFoundError';
    this.code = 'PRINTER_NOT_FOUND';
  }
}

// Scans every USB device for one exposing a Printer-class interface. Devices
// that can't be opened (wrong permissions, host controllers, hubs, devices
// that vanished mid-scan) are skipped rather than aborting the whole scan —
// on a real machine plenty of unrelated devices (webcam, keyboard, hubs)
// share the bus with the printer.
function findPrinterInterface() {
  for (const device of usb.getDeviceList()) {
    let opened = false;
    try {
      device.open();
      opened = true;
      const iface = (device.interfaces || []).find(
        (i) => i.descriptor.bInterfaceClass === PRINTER_INTERFACE_CLASS
      );
      if (iface) return { device, iface };
      device.close();
    } catch {
      if (opened) {
        try {
          device.close();
        } catch {
          // already gone
        }
      }
    }
  }
  return null;
}

// Sends a raw ESC/POS byte buffer (see escposReceipt.js) to the first
// detected USB printer. Claims the interface, writes to its bulk OUT
// endpoint, then always releases/closes — even on failure — so a failed
// print doesn't leave the device claimed for the next attempt.
async function sendRaw(buffer) {
  const found = findPrinterInterface();
  if (!found) {
    throw new PrinterNotFoundError(
      'No USB printer found. Check it is powered on, connected, and not in use by another app.'
    );
  }
  const { device, iface } = found;
  try {
    iface.claim();
    const outEndpoint = iface.endpoints.find((e) => e.direction === 'out');
    if (!outEndpoint) {
      throw new Error('USB printer has no OUT endpoint on its printer-class interface');
    }
    await outEndpoint.transferAsync(buffer);
  } finally {
    await new Promise((resolve) => iface.release(true, () => resolve()));
    try {
      device.close();
    } catch {
      // already closed/gone
    }
  }
}

module.exports = { sendRaw, findPrinterInterface, PrinterNotFoundError };
