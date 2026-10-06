// Online orders (API / WooCommerce / Shopify / QR menu / click-and-collect).
//
// Stock model: an order does NOT move Product.stock. Open orders (NEW,
// PACKING, READY) are *reservations*: availability = stock − reserved. Stock
// is only decremented when the order is billed at collection, through the
// normal checkout service — so cancelling an order needs no stock unwinding
// and serial/IMEI units are assigned at hand-over, not at order time.
const crypto = require('crypto');
const prisma = require('./prisma');
const { round2, effectivePrice } = require('./pricing');
const { r3 } = require('./qty');
const { performCheckout, checkoutSchema } = require('./checkout');
const { notifyEvent } = require('./webhooks');

const OPEN = ['NEW', 'PACKING', 'READY'];
const NEXT = { NEW: ['PACKING', 'READY', 'CANCELLED'], PACKING: ['READY', 'CANCELLED'], READY: ['CANCELLED'] };

const err = (m, status = 400) => Object.assign(new Error(m), { status });

// 6 chars, no look-alikes (0/O, 1/I) — read out loud or scanned as Code128.
function pickupCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
}

async function reservedByProduct(tx, productIds) {
  const rows = await tx.orderItem.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds }, order: { status: { in: OPEN } } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.productId, r._sum.quantity || 0]));
}

/** items: [{ productId, quantity }] — prices always come from the catalog. */
async function createOrder(input) {
  const { channel, externalId = null, fulfilment = 'PICKUP', tableNo = null, customer = {}, items, note = null, paid = false, paymentRef = null, apiKeyId = null } = input;
  if (!items?.length) throw err('Order has no items');

  return prisma.$transaction(async (tx) => {
    if (externalId) {
      const prior = await tx.order.findUnique({ where: { channel_externalId: { channel, externalId } }, include: { items: true } });
      if (prior) return { order: prior, deduplicated: true };
    }
    const settings = await tx.shopSettings.findFirst();
    const products = await tx.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
    const map = new Map(products.map((p) => [p.id, p]));
    const reserved = await reservedByProduct(tx, [...map.keys()]);

    const lines = [];
    for (const it of items) {
      const p = map.get(it.productId);
      if (!p) throw err(`Product ${it.productId} not found`, 404);
      const available = r3(p.stock - (reserved.get(p.id) || 0));
      if (!settings?.allowNegativeStock && available + 1e-9 < it.quantity) {
        throw err(`Not enough stock for "${p.name}" (available ${available})`, 409);
      }
      lines.push({ productId: p.id, name: p.name, quantity: it.quantity, price: effectivePrice(p) });
    }
    const total = round2(lines.reduce((s, l) => s + l.price * l.quantity, 0));
    const order = await tx.order.create({
      data: {
        channel, externalId, fulfilment, tableNo, pickupCode: pickupCode(), note, paid, paymentRef, apiKeyId, total,
        customerName: customer.name || 'Online Customer', customerPhone: customer.phone || null, customerEmail: customer.email || null,
        items: { create: lines },
      },
      include: { items: true },
    });
    return { order, deduplicated: false };
  }).then((out) => {
    if (!out.deduplicated) notifyEvent('order.created', publicOrder(out.order));
    return out;
  });
}

function publicOrder(o) {
  return {
    id: o.id, channel: o.channel, externalId: o.externalId, status: o.status, fulfilment: o.fulfilment, tableNo: o.tableNo,
    pickupCode: o.pickupCode, customerName: o.customerName, customerPhone: o.customerPhone, total: o.total, paid: o.paid,
    invoiceId: o.invoiceId, createdAt: o.createdAt,
    items: (o.items || []).map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, price: i.price })),
  };
}

async function setStatus(id, status) {
  const o = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!o) throw err('Order not found', 404);
  if (!(NEXT[o.status] || []).includes(status)) throw err(`Cannot move an order from ${o.status} to ${status}`, 409);
  const updated = await prisma.order.update({ where: { id }, data: { status }, include: { items: true } });
  notifyEvent('order.updated', publicOrder(updated));
  return updated;
}

/**
 * Hand the order over and bill it. Billing goes through the shared checkout
 * service; `serials` maps productId -> [serial...] for tracked products.
 * Prepaid orders are billed as paid in full.
 */
async function collect(id, { paymentMethod, amountPaid = 0, serials = {}, user }) {
  const o = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!o) throw err('Order not found', 404);
  if (o.status === 'COLLECTED') throw err('Order was already collected', 409);
  if (o.status === 'CANCELLED') throw err('Order is cancelled', 409);

  const body = checkoutSchema.parse({
    customerName: o.customerName,
    customerPhone: o.customerPhone || '',
    items: o.items.map((i) => ({ productId: i.productId, quantity: i.quantity, serials: serials[i.productId] })),
    paymentMethod: o.paid ? (paymentMethod === 'CARD' ? 'CARD' : 'UPI') : paymentMethod,
    amountPaid,
    externalRef: `order-${o.id}`,
  });
  // Idempotent per order: a double-click can't bill twice.
  const { invoice } = await performCheckout(body, { source: 'ORDER', cashierName: user?.name, user, apiKeyId: null });
  const updated = await prisma.order.update({ where: { id }, data: { status: 'COLLECTED', invoiceId: invoice.id }, include: { items: true } });
  notifyEvent('order.updated', publicOrder(updated));
  return { order: updated, invoice };
}

module.exports = { createOrder, setStatus, collect, publicOrder, reservedByProduct, OPEN };
