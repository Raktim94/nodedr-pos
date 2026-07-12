const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { buildReceiptHtml } = require('../lib/receipt');
const { buildReceiptPdf } = require('../lib/pdf');
const { buildReceiptEscPos } = require('../lib/escposReceipt');
const { sendRaw, PrinterNotFoundError } = require('../lib/escposUsb');

const router = express.Router();
router.use(requireAuth);

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
