const { z } = require('zod');
const prisma = require('./prisma');
const { checkoutSchema, performCheckout } = require('./checkout');
const { receiptUrl } = require('./publicLink');
const { qtySchema } = require('./qty');

const billSchema = z.object({
  // Your own order id. Required: it makes the call idempotent — sending the
  // same externalRef twice returns the first bill instead of billing again.
  externalRef: z.string().trim().min(1).max(120),
  customer: z
    .object({ name: z.string().trim().max(200).optional(), phone: z.string().trim().max(30).optional() })
    .optional(),
  items: z
    .array(
      z
        .object({
          sku: z.string().trim().min(1).max(64).optional(),
          barcode: z.string().trim().min(1).max(64).optional(),
          quantity: qtySchema,
          serials: z.array(z.string().trim().min(1).max(64)).max(1000).optional(),
        })
        .refine((i) => i.sku || i.barcode, { message: 'Each item needs a sku or barcode' })
    )
    .min(1)
    .max(200),
  discountType: z.enum(['percent', 'amount']).nullish(),
  discountValue: z.number().min(0).default(0),
  paymentMethod: z.enum(['CASH', 'UPI', 'CARD']).default('UPI'),
  // CASH only: amount received. UPI/CARD are treated as paid in full.
  amountPaid: z.number().min(0).default(0),
});

function publicInvoice(inv) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    externalRef: inv.externalRef,
    createdAt: inv.createdAt,
    customerName: inv.customerName,
    customerPhone: inv.customerPhone,
    subtotal: inv.subtotal,
    discountAmount: inv.discountAmount,
    taxAmount: inv.taxAmount,
    totalAmount: inv.totalAmount,
    paymentMethod: inv.paymentMethod,
    amountPaid: inv.amountPaid,
    dueAmount: inv.dueAmount,
    items: (inv.items || []).map((it) => ({
      name: it.name,
      quantity: it.quantity,
      unit: it.unit,
      price: it.price,
      taxRate: it.taxRate,
      total: it.total,
      warrantyMonths: it.warrantyMonths,
      ...(it.serials ? { serials: it.serials.map((s) => s.serial) } : {}),
    })),
  };
}



// Creates (or, for a repeated externalRef, returns) a bill on behalf of an
// API key. Shared by POST /api/external/bills and the MCP create_bill tool.
async function createExternalBill(input, apiKey, baseUrl) {
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) throw Object.assign(new Error('Invalid input'), { status: 400, details: parsed.error.flatten() });
  const b = parsed.data;

  const codes = [...new Set(b.items.flatMap((i) => [i.sku, i.barcode].filter(Boolean)))];
  const products = await prisma.product.findMany({
    // Only SKU-linked products are reachable through the API (see routes/external.js).
    where: { sku: { not: null }, OR: [{ sku: { in: codes } }, { barcode: { in: codes } }] },
  });
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku, p]));
  const byBarcode = new Map(products.map((p) => [p.barcode, p]));
  const items = b.items.map((i) => {
    const p = (i.sku && bySku.get(i.sku)) || (i.barcode && byBarcode.get(i.barcode));
    if (!p) throw Object.assign(new Error(`No product found for ${i.sku || i.barcode}`), { status: 404 });
    return { productId: p.id, quantity: i.quantity, serials: i.serials };
  });

  const body = checkoutSchema.parse({
    customerName: b.customer?.name || '',
    customerPhone: b.customer?.phone || '',
    items,
    discountType: b.discountType,
    discountValue: b.discountValue,
    paymentMethod: b.paymentMethod,
    amountPaid: b.amountPaid,
    externalRef: b.externalRef,
  });
  const { invoice, deduplicated } = await performCheckout(body, {
    source: 'API',
    apiKeyId: apiKey.id,
    cashierName: apiKey.name,
  });
  return { deduplicated, invoice: publicInvoice(invoice), receiptUrl: receiptUrl(baseUrl, invoice.id) };
}

const billInclude = { items: { include: { serials: { select: { serial: true, warrantyEndsAt: true } }, product: { select: { hsn: true } } } } };

// An invoice created by THIS key, found by invoice number or by your own
// externalRef. A key can never read bills it didn't create — a leaked
// storefront key must not expose in-store sales.
function findOwnBill(apiKeyId, ref) {
  return prisma.invoice.findFirst({
    where: { apiKeyId, OR: [{ invoiceNumber: String(ref) }, { externalRef: String(ref) }] },
    include: billInclude,
  });
}

module.exports = { billSchema, createExternalBill, publicInvoice, findOwnBill };
