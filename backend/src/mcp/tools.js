// MCP tools exposing the POS to an AI agent or storefront automation. Each
// tool is registered only if the API key behind the connection holds the
// matching scope, so an agent can never see — let alone call — a tool its
// key wasn't granted. Money rules are NOT reimplemented here: bills go
// through the same checkout service as the till and the REST External API.
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { createExternalBill, publicInvoice, findOwnBill } = require('../lib/externalBills');
const { lookupWarranty } = require('../lib/warranty');
const { receiptUrl } = require('../lib/publicLink');
const { notifyStockChange } = require('../lib/webhooks');
const orders = require('../lib/orders');

const text = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true });

const product = (p) => ({
  sku: p.sku, barcode: p.barcode, name: p.name, category: p.category, stock: p.stock, unit: p.unit,
  sellingPrice: p.sellingPrice, taxRate: p.taxRate, trackSerial: p.trackSerial, warrantyMonths: p.warrantyMonths,
});

function wrap(fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (!err.status) console.error('mcp tool error', err);
      return fail(err.status && err.status < 500 ? err.message : 'Tool failed');
    }
  };
}

function registerTools(server, { apiKey, scopes, baseUrl }) {
  const has = (s) => scopes.includes(s);

  if (has('products:read')) {
    server.registerTool(
      'search_products',
      {
        title: 'Search products',
        description: 'Search the shop catalog by name, category, SKU or barcode. Returns price, GST rate and live stock.',
        inputSchema: { query: z.string().max(80).optional(), limit: z.number().int().min(1).max(50).default(20) },
      },
      wrap(async ({ query, limit }) => {
        const q = query?.trim();
        const rows = await prisma.product.findMany({
          where: q ? { OR: [{ name: { contains: q } }, { category: { contains: q } }, { sku: q }, { barcode: q }] } : undefined,
          orderBy: { name: 'asc' },
          take: limit,
        });
        return text(rows.map(product));
      })
    );

    server.registerTool(
      'get_stock',
      {
        title: 'Get stock',
        description: 'Live stock and price for one product by SKU or barcode.',
        inputSchema: { code: z.string().min(1).max(64) },
      },
      wrap(async ({ code }) => {
        const p = (await prisma.product.findUnique({ where: { sku: code } })) || (await prisma.product.findUnique({ where: { barcode: code } }));
        return p ? text(product(p)) : fail('No product with that SKU/barcode');
      })
    );
  }

  if (has('stock:write')) {
    server.registerTool(
      'adjust_stock',
      {
        title: 'Adjust stock',
        description: 'Change stock of a SKU-linked, non-serial product by a signed delta (e.g. -2 after an online sale) or set an absolute value. Provide exactly one of delta or set.',
        inputSchema: { sku: z.string().min(1).max(64), delta: z.number().optional(), set: z.number().min(0).optional() },
      },
      wrap(async ({ sku, delta, set }) => {
        if ((delta === undefined) === (set === undefined)) return fail('Send exactly one of delta or set');
        const updated = await prisma.$transaction(async (tx) => {
          const p = await tx.product.findUnique({ where: { sku } });
          if (!p) throw Object.assign(new Error('No product linked to that SKU'), { status: 404 });
          if (p.trackSerial) throw Object.assign(new Error('Serial-tracked product: stock follows its registered units'), { status: 409 });
          const next = set !== undefined ? set : p.stock + delta;
          if (next < 0) {
            const settings = await tx.shopSettings.findFirst();
            if (!settings?.allowNegativeStock) throw Object.assign(new Error(`Insufficient stock (have ${p.stock})`), { status: 409 });
          }
          return tx.product.update({ where: { id: p.id }, data: { stock: Math.max(0, next) } });
        });
        notifyStockChange([{ sku: updated.sku, stock: updated.stock }]);
        return text(product(updated));
      })
    );
  }

  if (has('bills:write')) {
    server.registerTool(
      'create_bill',
      {
        title: 'Create bill',
        description:
          'Take a bill from the POS for an online order. Prices/GST/stock are computed by the POS. externalRef is your order id and makes the call idempotent. Serial-tracked items (phones etc.) need `serials` (IMEI) per unit. UPI/CARD = paid in full; CASH uses amountPaid (shortfall becomes customer due, which needs a customer phone).',
        inputSchema: {
          externalRef: z.string().min(1).max(120),
          customerName: z.string().max(200).optional(),
          customerPhone: z.string().max(30).optional(),
          items: z
            .array(z.object({ sku: z.string().optional(), barcode: z.string().optional(), quantity: z.number().positive(), serials: z.array(z.string()).optional() }))
            .min(1)
            .max(200),
          paymentMethod: z.enum(['CASH', 'UPI', 'CARD']).default('UPI'),
          amountPaid: z.number().min(0).default(0),
          discountType: z.enum(['percent', 'amount']).optional(),
          discountValue: z.number().min(0).default(0),
        },
      },
      wrap(async (a) => {
        const out = await createExternalBill(
          {
            externalRef: a.externalRef,
            customer: { name: a.customerName, phone: a.customerPhone },
            items: a.items,
            paymentMethod: a.paymentMethod,
            amountPaid: a.amountPaid,
            discountType: a.discountType,
            discountValue: a.discountValue,
          },
          apiKey,
          baseUrl
        );
        return text(out);
      })
    );
  }

  if (has('orders:write')) {
    server.registerTool(
      'create_order',
      {
        title: 'Create click-and-collect order',
        description: 'Reserve stock for an online order without billing it. The shop bills it at hand-over (or use create_bill for an immediate sale). externalRef makes it idempotent. Returns a pickup code for the customer.',
        inputSchema: {
          externalId: z.string().min(1).max(120),
          customerName: z.string().max(160).optional(),
          customerPhone: z.string().max(30).optional(),
          fulfilment: z.enum(['PICKUP', 'DELIVERY']).default('PICKUP'),
          paid: z.boolean().default(false),
          items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().positive() })).min(1).max(200),
        },
      },
      wrap(async (a) => {
        const products = await prisma.product.findMany({ where: { sku: { in: a.items.map((i) => i.sku) } } });
        const items = a.items.map((i) => {
          const p = products.find((x) => x.sku === i.sku);
          if (!p) throw Object.assign(new Error(`No product with SKU ${i.sku}`), { status: 404 });
          return { productId: p.id, quantity: i.quantity };
        });
        const { order, deduplicated } = await orders.createOrder({
          channel: 'API', externalId: a.externalId, fulfilment: a.fulfilment, paid: a.paid, items,
          customer: { name: a.customerName, phone: a.customerPhone }, apiKeyId: apiKey.id,
        });
        return text({ deduplicated, order: orders.publicOrder(order) });
      })
    );

    server.registerTool(
      'get_order',
      { title: 'Get order', description: 'Status of an order created through this key (by your externalId).', inputSchema: { externalId: z.string().min(1).max(120) } },
      wrap(async ({ externalId }) => {
        const o = await prisma.order.findFirst({ where: { apiKeyId: apiKey.id, externalId }, include: { items: true } });
        return o ? text(orders.publicOrder(o)) : fail('Order not found');
      })
    );
  }

  if (has('bills:read')) {
    server.registerTool(
      'get_bill',
      {
        title: 'Get bill',
        description: 'Fetch a bill created through this API key by invoice number or your externalRef, with a shareable PDF link.',
        inputSchema: { ref: z.string().min(1).max(120) },
      },
      wrap(async ({ ref }) => {
        const inv = await findOwnBill(apiKey.id, ref);
        return inv ? text({ invoice: publicInvoice(inv), receiptUrl: receiptUrl(baseUrl, inv.id) }) : fail('Bill not found');
      })
    );
  }

  if (has('warranty:read')) {
    server.registerTool(
      'check_warranty',
      {
        title: 'Check warranty',
        description: 'Warranty status for a scanned IMEI / serial number: product, sale date, warranty end, days left and history.',
        inputSchema: { serial: z.string().min(4).max(64) },
      },
      wrap(async ({ serial }) => {
        const w = await lookupWarranty(serial, { includePrivate: false });
        return w ? text(w) : fail('No unit with that serial/IMEI');
      })
    );
  }
}

module.exports = { registerTools };
