// Online orders from e-commerce stores (API / WooCommerce / Shopify) —
// click-and-collect or delivery.
//
// Stock model: an order does NOT move Product.stock. Open orders (NEW,
// PACKING, READY) are *reservations*: availability = stock − reserved. Stock
// is only decremented when the order is handed over (COLLECTED) — so
// cancelling an order needs no stock unwinding.
//
// The POS does NOT bill online orders: the customer's invoice/payment belongs
// to the e-commerce store that took the order. Handing over only releases the
// goods (stock out) and tells the store the order is collected.
const crypto = require('crypto');
const prisma = require('./prisma');
const { round2, effectivePrice } = require('./pricing');
const { r3 } = require('./qty');
const { notifyEvent, notifyStockChange } = require('./webhooks');

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
  const { channel, externalId = null, fulfilment = 'PICKUP', customer = {}, items, note = null, paid = false, paymentRef = null, apiKeyId = null, integrationId = null } = input;
  if (!items?.length) throw err('Order has no items');
  // externalId is only unique within its sender (API key / connected store), so
  // one key can neither read nor squat another key's order ids.
  const dedupScope = apiKeyId ? `key:${apiKeyId}` : integrationId ? `store:${integrationId}` : '';

  return prisma.$transaction(async (tx) => {
    if (externalId) {
      const prior = await tx.order.findUnique({ where: { channel_dedupScope_externalId: { channel, dedupScope, externalId } }, include: { items: true } });
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
        channel, externalId, dedupScope, fulfilment, pickupCode: pickupCode(), note, paid, paymentRef, apiKeyId, integrationId, total,
        customerName: customer.name || 'Online Customer', customerPhone: customer.phone || null, customerEmail: customer.email || null,
        items: { create: lines },
      },
      include: { items: true },
    });
    return { order, deduplicated: false };
  }).then((out) => {
    if (!out.deduplicated) emitOrderEvent('order.created', out.order, null);
    return out;
  });
}

// One place every status change goes through: tell the API-key owner (signed
// webhook) and push the new status to the originating WooCommerce/Shopify
// store. Both are fire-and-forget — the till never waits on a storefront.
function emitOrderEvent(event, order, previousStatus) {
  const data = { ...publicOrder(order), previousStatus };
  notifyEvent(event, data, { apiKeyId: order.apiKeyId });
  if (order.integrationId && event === 'order.updated') {
    require('./stores').pushOrderStatus(order).catch((e) => console.error(`order status push to store failed (order ${order.id}): ${e.message}`));
  }
}

function publicOrder(o) {
  return {
    id: o.id, channel: o.channel, externalId: o.externalId, status: o.status, fulfilment: o.fulfilment,
    pickupCode: o.pickupCode, customerName: o.customerName, customerPhone: o.customerPhone, total: o.total, paid: o.paid,
    invoiceId: o.invoiceId, createdAt: o.createdAt, updatedAt: o.updatedAt,
    items: (o.items || []).map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, price: i.price })),
  };
}

async function setStatus(id, status) {
  const o = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!o) throw err('Order not found', 404);
  if (!(NEXT[o.status] || []).includes(status)) throw err(`Cannot move an order from ${o.status} to ${status}`, 409);
  const updated = await prisma.order.update({ where: { id }, data: { status }, include: { items: true } });
  emitOrderEvent('order.updated', updated, o.status);
  return updated;
}

/**
 * Hand the order over: take the goods out of stock and mark it COLLECTED. No
 * invoice is created — billing is the e-commerce store's job.
 */
async function collect(id) {
  const o = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!o) throw err('Order not found', 404);
  if (o.status === 'COLLECTED') throw err('Order was already collected', 409);
  if (o.status === 'CANCELLED') throw err('Order is cancelled', 409);

  // One transaction: claim the order (so two concurrent hand-overs — a double
  // click, two tills — can't both take stock) and decrement stock. Any failure
  // rolls the whole thing back, including the claim.
  const changed = [];
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({ where: { id, status: { in: OPEN } }, data: { status: 'COLLECTED' } });
    if (claimed.count !== 1) throw err('Order was already collected or cancelled', 409);
    const settings = await tx.shopSettings.findFirst();
    for (const it of o.items) {
      const p = await tx.product.findUnique({ where: { id: it.productId } });
      if (!p) continue; // product deleted since the order — nothing to take out
      if (!settings?.allowNegativeStock && p.stock + 1e-9 < it.quantity) {
        throw err(`Not enough stock for "${p.name}" to hand over (have ${p.stock})`, 409);
      }
      const after = await tx.product.update({ where: { id: p.id }, data: { stock: { decrement: it.quantity } } });
      if (after.sku) changed.push({ sku: after.sku, stock: after.stock });
    }
    return tx.order.findUnique({ where: { id }, include: { items: true } });
  });
  if (changed.length) notifyStockChange(changed);
  emitOrderEvent('order.updated', updated, o.status);
  return { order: updated };
}

module.exports = { createOrder, setStatus, collect, publicOrder, reservedByProduct, OPEN };
