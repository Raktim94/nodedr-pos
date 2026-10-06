const prisma = require('./prisma');
const { normalizeSerial, warrantyStatus } = require('./serials');

// Shared by the warranty route, the External API and MCP. Returns null when
// the serial is unknown. `includePrivate` controls whether the buyer's
// phone/name is included — external callers get it only with warranty:read.
async function lookupWarranty(rawSerial, { includePrivate = true } = {}) {
  const unit = await prisma.serialUnit.findUnique({
    where: { serial: normalizeSerial(rawSerial) },
    include: {
      product: { select: { id: true, name: true, sku: true, barcode: true, warrantyMonths: true } },
      invoiceItem: { select: { invoice: { select: { id: true, invoiceNumber: true, customerName: true, customerPhone: true, createdAt: true } } } },
      events: { orderBy: { createdAt: 'asc' }, take: 100 },
    },
  });
  if (!unit) return null;
  const inv = unit.invoiceItem?.invoice;
  const daysLeft =
    unit.warrantyEndsAt && unit.status === 'SOLD'
      ? Math.ceil((new Date(unit.warrantyEndsAt).getTime() - Date.now()) / 86400000)
      : null;
  return {
    serial: unit.serial,
    status: unit.status,
    warranty: warrantyStatus(unit),
    warrantyMonths: unit.product.warrantyMonths,
    soldAt: unit.soldAt,
    warrantyEndsAt: unit.warrantyEndsAt,
    daysLeft,
    product: { id: unit.product.id, name: unit.product.name, sku: unit.product.sku, barcode: unit.product.barcode },
    invoice: inv
      ? {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          date: inv.createdAt,
          ...(includePrivate ? { customerName: inv.customerName, customerPhone: inv.customerPhone } : {}),
        }
      : null,
    history: unit.events.map((e) => ({ type: e.type, note: e.note, at: e.createdAt })),
  };
}

module.exports = { lookupWarranty };
