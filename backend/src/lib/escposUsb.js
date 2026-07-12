// Sends raw ESC/POS bytes (see escposReceipt.js) to a USB thermal receipt
// printer. Two transports are tried in order, so it "just works" on a Debian
// till without the operator finding vendor:product IDs or running anything:
//
//   1. The kernel usblp CHARACTER DEVICE (/dev/usb/lp0). This is the SAME
//      path a plain `echo "hi" > /dev/usb/lp0` in a terminal uses — so if
//      that works, this works. It also covers the many generic 80mm printers
//      that present a *vendor-specific* USB class (0xFF) rather than the
//      Printer class (7): the kernel binds them via usblp anyway, but a
//      libusb class-7 scan (transport #2) would miss them entirely and report
//      "no printer found". This is the primary path for exactly that reason.
//
//   2. libusb raw bulk transfer (the `usb` npm package). Fallback for setups
//      where usblp isn't bound (no lp node) — e.g. a printer claimed by a
//      different driver, or a non-Linux host. Detaches any kernel driver
//      first so the interface can be claimed.
//
// In a container the lp node may not exist even though the HOST kernel has
// the printer bound; with the major-180 device_cgroup_rules entry (see
// docker-compose.yml) we can mknod it on demand and write straight through to
// the same kernel driver — no host bind mount, and nothing to fail at
// `compose up` when no printer is attached.
const fs = require('fs');
const { execFileSync } = require('child_process');
const usb = require('usb');

const PRINTER_INTERFACE_CLASS = 7;
const USBLP_MAJOR = 180; // major device number of the kernel usblp driver

class PrinterNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrinterNotFoundError';
    this.code = 'PRINTER_NOT_FOUND';
  }
}

// --- Transport 1: kernel usblp character device --------------------------

// The usblp node layouts across distros (/dev/usb/lpN on Debian/udev,
// /dev/usblpN on some others). Only the first few minors — a till has one
// printer, occasionally a second; scanning higher just wastes syscalls.
function candidateLpPaths() {
  const paths = [];
  for (let i = 0; i < 4; i++) paths.push(`/dev/usb/lp${i}`, `/dev/usblp${i}`);
  return paths;
}

// The lp nodes we can attempt to write to. Prefers nodes ALREADY present (any
// minor, so a printer at lp1 is found too); only when none exist does it try
// to create /dev/usb/lp{0..3} (major 180, minor N). Node creation succeeds
// only with the privilege/cgroup grant to do so (root + `c 180:* rmw` — see
// docker-compose.yml); every step is best-effort, so with no privilege we
// simply return whatever already exists and let libusb take over. All mknod
// arguments are constant (no user input), so there's no shell-injection
// surface here.
function usableLpPaths() {
  const existing = candidateLpPaths().filter((p) => {
    try {
      return fs.statSync(p).isCharacterDevice();
    } catch {
      return false;
    }
  });
  if (existing.length > 0) return existing;

  const made = [];
  try {
    fs.mkdirSync('/dev/usb', { recursive: true });
    for (let minor = 0; minor < 4; minor++) {
      const target = `/dev/usb/lp${minor}`;
      try {
        execFileSync('mknod', ['-m', '660', target, 'c', String(USBLP_MAJOR), String(minor)]);
        made.push(target);
      } catch {
        // couldn't create this minor (already exists / not permitted)
      }
    }
  } catch {
    // no privilege even to mkdir — fall through with an empty list
  }
  return made;
}

// A stalled write to an offline/out-of-paper printer would otherwise hang the
// request until the client aborts AND pin a libuv threadpool thread; cap it.
const CHAR_WRITE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out writing to ${label} — printer not responding`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

// Writes the buffer to the first usblp node backed by a real printer, exactly
// like redirecting to it from a shell. Returns true on a successful write;
// false when no node is backed by a printer (caller then tries libusb). A node
// that IS backed but errors mid-write (out of paper, etc.) throws.
async function sendViaCharDevice(buffer) {
  const paths = usableLpPaths();
  let lastRealError = null;
  for (const path of paths) {
    let handle;
    try {
      handle = await fs.promises.open(path, 'w');
    } catch (err) {
      // Node present but nothing bound to it (phantom node / printer on a
      // different minor / not writable) — try the next candidate rather than
      // failing outright.
      if (['ENODEV', 'ENXIO', 'ENOENT', 'EACCES'].includes(err.code)) continue;
      lastRealError = err;
      continue;
    }
    try {
      // A single write() may not flush the whole buffer, so loop until every
      // byte is sent (each chunk under the same stall timeout).
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await withTimeout(
          handle.write(buffer, offset, buffer.length - offset),
          CHAR_WRITE_TIMEOUT_MS,
          path
        );
        if (bytesWritten <= 0) break;
        offset += bytesWritten;
      }
      return true;
    } finally {
      await handle.close().catch(() => {});
    }
  }
  if (lastRealError) throw lastRealError;
  return false;
}

// --- Transport 2: libusb raw bulk ----------------------------------------

// Scans every USB device for one exposing a Printer-class interface. Devices
// that can't be opened (wrong permissions, host controllers, hubs, devices
// that vanished mid-scan) are skipped rather than aborting the whole scan.
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

// On Linux usblp claims the printer's interface, so libusb's iface.claim()
// fails with LIBUSB_ERROR_BUSY unless we detach the kernel driver first. On
// Windows/macOS these calls throw LIBUSB_ERROR_NOT_SUPPORTED, so they're
// best-effort and swallowed.
function detachKernelDriver(iface) {
  try {
    if (iface.isKernelDriverActive()) {
      iface.detachKernelDriver();
      return true;
    }
  } catch {
    // not supported / already detached
  }
  return false;
}

async function sendViaLibusb(buffer) {
  const found = findPrinterInterface();
  if (!found) return false;
  const { device, iface } = found;
  const reattach = detachKernelDriver(iface);
  try {
    try {
      iface.claim();
    } catch (err) {
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
    // Give the bulk transfer a real timeout instead of the default 0 (wait
    // forever) so an unresponsive printer errors rather than hanging.
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
  return true;
}

// --- Public API ----------------------------------------------------------

// Tries the kernel char device first (matches a working `echo > /dev/usb/lp0`
// and handles vendor-class printers), then libusb. Throws PrinterNotFoundError
// only when neither transport can reach a printer.
async function sendRaw(buffer) {
  let charDeviceError = null;
  try {
    if (await sendViaCharDevice(buffer)) return;
  } catch (err) {
    // A node existed but the write failed (offline/unplugged). Remember it,
    // but still try libusb in case a different device is reachable that way.
    charDeviceError = err;
  }

  try {
    if (await sendViaLibusb(buffer)) return;
  } catch (err) {
    // A concrete libusb failure (busy, no endpoint, etc.) is more useful than
    // the generic char-device error, so surface it.
    throw err;
  }

  // Neither transport found a printer.
  if (charDeviceError) {
    throw new PrinterNotFoundError(
      'Found a printer device but could not write to it. Check it is powered on, has paper, and is connected.'
    );
  }
  throw new PrinterNotFoundError(
    'No USB printer found. Check it is powered on, connected, and not in use by another app.'
  );
}

module.exports = { sendRaw, findPrinterInterface, usableLpPaths, PrinterNotFoundError };
