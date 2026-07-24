const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { buildReceiptHtml } = require('../lib/receipt');
const { buildReceiptPdf } = require('../lib/pdf');
const { buildReceiptEscPos } = require('../lib/escposReceipt');
const { sendRaw, findPrinterInterface, probeCharDevices, PrinterNotFoundError } = require('../lib/escposUsb');

const router = express.Router();
router.use(requireAuth);

// GET /api/print/diagnostics — read-only report of what the direct-USB path
// can actually see, so a shop can tell WHY printing does or doesn't work from
// a single button click instead of reading container logs. Does not print.
router.get('/diagnostics', async (req, res) => {
  const result = { lpDevices: [], libusbPrinter: null, canPrint: false, notes: [] };

  try {
    // Probe (open-test) rather than list, so a node we can create but that has
    // no printer bound to it isn't mistaken for a working printer.
    result.lpDevices = await probeCharDevices();
  } catch (err) {
    result.notes.push(`Could not check /dev/usb/lp* nodes: ${err.message}`);
  }

  try {
    const found = findPrinterInterface();
    if (found) {
      const d = found.device.deviceDescriptor;
      result.libusbPrinter = {
        vendorId: d.idVendor,
        productId: d.idProduct,
        id: `${d.idVendor.toString(16).padStart(4, '0')}:${d.idProduct.toString(16).padStart(4, '0')}`,
      };
      // findPrinterInterface leaves the device open on a match — release it.
      try {
        found.device.close();
      } catch {
        // already gone
      }
    }
  } catch (err) {
    result.notes.push(`USB scan failed: ${err.message}`);
  }

  result.canPrint = result.lpDevices.length > 0 || result.libusbPrinter !== null;
  if (!result.canPrint) {
    result.notes.push(
      'No printer detected. On the till, check `lsusb` lists it and `ls -l /dev/usb/lp0` exists; the backend container needs the USB passthrough from docker-compose.yml (Linux host only).'
    );
  }
  res.json(result);
});

// POST /api/print/test — sends a short test slip to the USB printer so the
// operator can confirm the hardware works end to end without ringing up a sale.
router.post('/test', async (req, res) => {
  const ESC = 0x1b;
  const GS = 0x1d;
  const buffer = Buffer.concat([
    Buffer.from([ESC, 0x40]), // initialize
    Buffer.from([ESC, 0x61, 0x01]), // center
    Buffer.from([ESC, 0x45, 0x01]), // bold on
    Buffer.from('Nodedr POS\n'),
    Buffer.from([ESC, 0x45, 0x00]), // bold off
    Buffer.from('Printer test OK\n'),
    Buffer.from([ESC, 0x61, 0x00]), // left
    Buffer.from(`${new Date().toLocaleString()}\n`),
    Buffer.from('\n\n\n\n'),
    Buffer.from([GS, 0x56, 0x00]), // full cut
  ]);

  try {
    await sendRaw(buffer);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof PrinterNotFoundError) {
      return res.status(503).json({ error: err.message });
    }
    console.error('USB test print failed:', err);
    res.status(500).json({ error: 'Could not print a test slip to the USB printer' });
  }
});

async function loadInvoiceAndShop(id) {
  const [invoice, shop] = await Promise.all([
    prisma.invoice.findUnique({ where: { id }, include: { items: true } }),
    prisma.shopSettings.findFirst(),
  ]);
  return { invoice, shop };
}

// GET /api/print/:invoiceId/receipt — a standalone, self-printing HTML page.
// Loaded into a hidden iframe on the same page (see frontend/lib/print.ts),
// it triggers window.print() so the browser's own print dialog handles
// printer selection (thermal, laser, "Save as PDF", whatever the OS/CUPS
// has configured) — we never talk to a USB device directly, and the
// cashier's screen never navigates away.
router.get('/:invoiceId/receipt', async (req, res) => {
  const id = Number(req.params.invoiceId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid invoice id' });

  const { invoice, shop } = await loadInvoiceAndShop(id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (!shop) return res.status(400).json({ error: 'Shop settings not configured' });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(buildReceiptHtml({ shop, invoice }));
});

// GET /api/print/:invoiceId/pdf — downloads the receipt as a PDF file.
router.get('/:invoiceId/pdf', async (req, res) => {
  const id = Number(req.params.invoiceId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid invoice id' });

  const { invoice, shop } = await loadInvoiceAndShop(id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (!shop) return res.status(400).json({ error: 'Shop settings not configured' });

  try {
    const pdf = await buildReceiptPdf({ shop, invoice });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: 'Could not generate PDF' });
  }
});

// POST /api/print/:invoiceId/usb — sends the receipt directly to a USB
// thermal printer over raw ESC/POS (see escposUsb.js/escposReceipt.js). A
// POST, unlike the two GET routes above, because unlike generating HTML or
// a PDF this has a real side effect on physical hardware.
router.post('/:invoiceId/usb', async (req, res) => {
  const id = Number(req.params.invoiceId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid invoice id' });

  const { invoice, shop } = await loadInvoiceAndShop(id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (!shop) return res.status(400).json({ error: 'Shop settings not configured' });

  try {
    const width = shop.usbPrinterWidth === 58 ? 32 : 42;
    const buffer = buildReceiptEscPos({ shop, invoice, width });
    await sendRaw(buffer);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof PrinterNotFoundError) {
      return res.status(503).json({ error: err.message });
    }
    console.error('USB print failed:', err);
    res.status(500).json({ error: 'Could not print to USB printer' });
  }
});

module.exports = router;
