// We talk to the printer directly via `escpos-usb` (a thin wrapper around
// the `usb` package) rather than the full `escpos` package — `escpos`
// pulls in `get-pixels` -> `request` for logo/image printing, which drags
// in several CVEs (form-data, tough-cookie, qs) we don't need since this
// app only ever prints plain-text receipts.
const USB = require('escpos-usb');

// Standard ESC/POS full paper cut, sent as raw bytes so the exact command
// from the spec is guaranteed.
const CUT_COMMAND = Buffer.from([0x1d, 0x56, 0x41, 0x00]);
const FEED_BEFORE_CUT = Buffer.from([0x1b, 0x64, 0x03]); // feed 3 lines, ESC d 3

function findDevice() {
  const devices = USB.findPrinter();
  if (!devices || devices.length === 0) return null;
  return new USB();
}

/**
 * Sends `text` (already laid out with padding/newlines) to the configured
 * USB thermal printer as a raw ESC/POS job, then cuts the paper.
 * Resolves { printed: true } on success, { printed: false, reason } if no
 * hardware is attached (e.g. running the backend without a printer for dev).
 */
function printReceipt(text) {
  return new Promise((resolve, reject) => {
    let device;
    try {
      device = findDevice();
    } catch (err) {
      return resolve({ printed: false, reason: `USB scan failed: ${err.message}` });
    }

    if (!device) {
      return resolve({ printed: false, reason: 'No USB thermal printer detected' });
    }

    device.open((err) => {
      if (err) return reject(new Error(`Failed to open printer device: ${err.message}`));

      const body = Buffer.concat([
        Buffer.from(text + '\n', 'ascii'),
        FEED_BEFORE_CUT,
        CUT_COMMAND,
      ]);

      device.write(body, (writeErr) => {
        try {
          device.close();
        } catch {
          // device already closing; ignore
        }
        if (writeErr) return reject(new Error(`Print job failed: ${writeErr.message}`));
        resolve({ printed: true });
      });
    });
  });
}

module.exports = { printReceipt, CUT_COMMAND };
