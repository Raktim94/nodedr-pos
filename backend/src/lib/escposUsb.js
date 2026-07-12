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

// On Linux the kernel's `usblp` module auto-binds to any USB Printer-class
// device the moment it's plugged in (creating /dev/usb/lp0) and CLAIMS its
// interface. libusb then can't claim the same interface — iface.claim()
// fails with LIBUSB_ERROR_BUSY — which is exactly why direct-USB printing
// works on Windows (a vendor/usbprint driver, not a kernel grab we can undo)
// but silently fails on a Debian machine. The fix is to detach the kernel
// driver first, print, then reattach it so the OS print path (CUPS/lp) keeps
// working afterwards. On Windows/macOS these calls throw
// LIBUSB_ERROR_NOT_SUPPORTED (there's no detachable kernel driver), so they
// are best-effort and swallowed — the plain claim() path there is unaffected.
function detachKernelDriver(iface) {
  try {
    if (iface.isKernelDriverActive()) {
      iface.detachKernelDriver();
      return true;
    }
  } catch {
    // Not supported on this platform (Windows/macOS) or already detached —
    // fall through and let claim() proceed / surface its own error.
  }
  return false;
}

// Sends a raw ESC/POS byte buffer (see escposReceipt.js) to the first
// detected USB printer. Detaches any kernel driver, claims the interface,
// writes to its bulk OUT endpoint, then always releases/reattaches/closes —
// even on failure — so a failed print doesn't leave the device claimed for
// the next attempt or stranded away from the OS print stack.
async function sendRaw(buffer) {
  const found = findPrinterInterface();
  if (!found) {
    throw new PrinterNotFoundError(
      'No USB printer found. Check it is powered on, connected, and not in use by another app.'
    );
  }
  const { device, iface } = found;
  const reattach = detachKernelDriver(iface);
  try {
    try {
      iface.claim();
    } catch (err) {
      // The most common real-world failure on Linux: another process (usblp,
      // CUPS, a previous crashed print) still holds the interface. Give the
      // operator an actionable message instead of a generic 500.
      if (/LIBUSB_ERROR_BUSY|EBUSY|resource busy/i.test(String(err && err.message))) {
        throw new PrinterNotFoundError(
          'The USB printer is busy — another program (or the OS print queue) is using it. Close it and try again.'
        );
      }
      throw err;
    }
    const outEndpoint = iface.endpoints.find((e) => e.direction === 'out');
    if (!outEndpoint) {
      throw new Error('USB printer has no OUT endpoint on its printer-class interface');
    }
    // A generic bulk endpoint can stall on an over-long single transfer;
    // give it a real timeout instead of the default 0 (== wait forever), so
    // an unresponsive printer surfaces as an error rather than a hung request.
    outEndpoint.timeout = 5000;
    await outEndpoint.transferAsync(buffer);
  } finally {
    await new Promise((resolve) => iface.release(true, () => resolve()));
    if (reattach) {
      try {
        iface.attachKernelDriver();
      } catch {
        // best-effort — restores /dev/usb/lp0 for the OS print path
      }
    }
    try {
      device.close();
    } catch {
      // already closed/gone
    }
  }
}

module.exports = { sendRaw, findPrinterInterface, PrinterNotFoundError };
