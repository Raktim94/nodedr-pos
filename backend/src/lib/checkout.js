const { z } = require('zod');
const prisma = require('./prisma');
const { computeSale, round2 } = require('./pricing');
const { notifyStockChange } = require('./webhooks');
const { validateSerial, normalizeSerial, addMonths } = require('./serials');
const { qtySchema } = require('./qty');
const { hasPerm } = require('../middleware/auth');
const { parseRates } = require('./fx');
const terminal = require('./terminal');

const checkoutSchema = z
  .object({
    customerName: z.string().trim().max(200).optional().or(z.literal('')),
    customerPhone: z.string().trim().max(30).optional().or(z.literal('')),
    items: z
      .array(
        z.object({
          productId: z.number().int().positive(),
          quantity: qtySchema,
          // IMEI / serial numbers for serial-tracked products — exactly
          // `quantity` of them, each an in-stock unit of that product.
          serials: z.array(z.string().trim().min(1).max(64)).max(1000).optional(),
        })
      )
      .default([]),
    discountType: z.enum(['percent', 'amount']).nullish(),
    discountValue: z.number().min(0).default(0),
    pointsRedeemed: z.number().int().min(0).default(0),
    paymentMethod: z.enum(['CASH', 'UPI', 'CARD']).default('CASH'),
    amountPaid: z.number().min(0).default(0),
    // Old outstanding due the customer chooses to clear as part of this bill.
    // Added on top of the goods total for what the cashier collects.
    duePaid: z.number().min(0).default(0),
    // Items being returned on this bill, grouped by the original invoice they
    // were sold on. refundAmount is optional per line (defaults to the price
    // originally charged for that quantity) so the cashier can refund less.
    returns: z
      .array(
        z.object({
          invoiceId: z.number().int().positive(),
          items: z
            .array(
              z.object({
                invoiceItemId: z.number().int().positive(),
                quantity: qtySchema,
                refundAmount: z.number().min(0).optional(),
                // Required for serial-tracked items: which sold units come back.
                serials: z.array(z.string().trim().min(1).max(64)).max(1000).optional(),
              })
            )
            .min(1),
        })
      )
      .default([]),
    // How to settle a refund that exceeds the purchase: pay it out in cash or
    // keep it as reusable store credit on the customer.
    refundMode: z.enum(['CASH', 'CREDIT']).default('CASH'),
    // Existing store credit the customer spends on this bill.
    creditApplied: z.number().min(0).default(0),
    // Idempotency key for API/webhook bills — the same ref never bills twice.
    externalRef: z.string().trim().min(1).max(120).optional(),
    customerGstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters').optional().or(z.literal('')),
    // Multi-currency: the currency the customer pays in. The RATE is always
    // taken from the server's own table, never from the client.
    payCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
    // Card terminal: id of a payment the reader reports as completed. The
    // server re-verifies it with the provider before trusting it.
    terminalPaymentId: z.string().trim().max(100).optional(),
  })
  .refine((d) => d.items.length > 0 || d.returns.length > 0 || d.duePaid > 0, {
    message: 'Add an item to sell, a return, or a previous due to collect',
  });


async function nextInvoiceNumber(tx) {
  const count = await tx.invoice.count();
  const year = new Date().getFullYear();
  return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
}

/**
 * Finalizes a sale. Every money figure is computed server-side from the
 * catalog and settings; the caller only supplies product ids, quantities and
 * intent. Used by the POS route, the External API and MCP so all three share
 * one set of rules. ctx = { source, apiKeyId, cashierName }.
 * Throws errors carrying `.status`.
 */
async function performCheckout(body, ctx = {}) {
  // Idempotent API bills: a retry with the same (apiKey, externalRef)
  // returns the invoice already created instead of billing twice.
  if (ctx.apiKeyId && body.externalRef) {
    const prior = await prisma.invoice.findUnique({
      where: { apiKeyId_externalRef: { apiKeyId: ctx.apiKeyId, externalRef: body.externalRef } },
      include: { items: true },
    });
    if (prior) return { invoice: prior, deduplicated: true };
  }

  // Card terminal payment: confirmed with the provider BEFORE the DB
  // transaction (a network call must never run while holding SQLite's write
  // lock). The amount is compared to the computed payable inside it.
  let verifiedTerminal = null;
  if (body.terminalPaymentId) {
    if (await prisma.invoice.findFirst({ where: { paymentRef: body.terminalPaymentId }, select: { id: true } })) {
      throw Object.assign(new Error('That card payment was already used for another bill'), { status: 409 });
    }
    const st = await terminal.getStatus(body.terminalPaymentId);
    if (st.status !== 'PAID') throw Object.assign(new Error(`Card payment is not completed (${st.status})`), { status: 402 });
    verifiedTerminal = { id: body.terminalPaymentId, amount: st.amount };
  }

  {
    const result = await prisma.$transaction(async (tx) => {
      const settings = await tx.shopSettings.findFirst();
      if (!settings) throw Object.assign(new Error('Shop settings not configured'), { status: 400 });

      const productIds = body.items.map((i) => i.productId);
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map((p) => [p.id, p]));

      const lines = [];
      for (const item of body.items) {
        const product = productMap.get(item.productId);
        if (!product) throw Object.assign(new Error(`Product ${item.productId} not found`), { status: 404 });
        if (!settings.allowNegativeStock && product.stock + 1e-9 < item.quantity) {
          throw Object.assign(
            new Error(`Insufficient stock for "${product.name}" (have ${product.stock}, need ${item.quantity})`),
            { status: 409 }
          );
        }
        lines.push({ product, quantity: item.quantity });
      }

      // Serial / IMEI tracked lines: the sale must name exactly the units
      // sold, every one in stock and belonging to that product.
      const serialPlan = []; // [{ lineIndex, units }]
      const seenSerials = new Set();
      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i];
        const product = lines[i].product;
        if (!product.trackSerial) {
          if (item.serials?.length) throw Object.assign(new Error(`"${product.name}" is not serial-tracked`), { status: 400 });
          continue;
        }
        const wanted = (item.serials || []).map((s) => {
          const v = validateSerial(s);
          if (!v.ok) throw Object.assign(new Error(v.error), { status: 400 });
          return v.serial;
        });
        if (wanted.length !== item.quantity) {
          throw Object.assign(new Error(`"${product.name}" needs ${item.quantity} serial/IMEI number(s), got ${wanted.length}`), { status: 400 });
        }
        for (const s of wanted) {
          if (seenSerials.has(s)) throw Object.assign(new Error(`Serial ${s} appears twice on this bill`), { status: 400 });
          seenSerials.add(s);
        }
        const units = await tx.serialUnit.findMany({ where: { serial: { in: wanted }, productId: product.id } });
        const byS = new Map(units.map((u) => [u.serial, u]));
        for (const s of wanted) {
          const u = byS.get(s);
          if (!u) throw Object.assign(new Error(`Serial ${s} is not registered for "${product.name}"`), { status: 404 });
          if (u.status !== 'IN_STOCK') throw Object.assign(new Error(`Serial ${s} is not in stock (${u.status})`), { status: 409 });
        }
        serialPlan.push({ lineIndex: i, units: wanted.map((s) => byS.get(s)) });
      }

      // Resolve customer (needed for loyalty). Match by phone; create if new
      // and a name was given. Cap redeemable points at the customer's balance.
      let customer = null;
      if (body.customerPhone) {
        customer = await tx.customer.findUnique({ where: { phone: body.customerPhone } });
        if (!customer && body.customerName) {
          customer = await tx.customer.create({
            data: { name: body.customerName, phone: body.customerPhone },
          });
        }
      }

      let pointsRedeemed = body.pointsRedeemed;
      if (!settings.loyaltyEnabled || !customer) pointsRedeemed = 0;
      if (customer && pointsRedeemed > customer.loyaltyPoints) pointsRedeemed = customer.loyaltyPoints;

      const computed = computeSale(lines, {
        discountType: body.discountType || null,
        discountValue: body.discountValue,
        pointsRedeemed,
        settings,
      });

      const saleTotal = computed.totalAmount;

      // Granular rights: a manual discount needs the 'discount' right and is
      // capped at the cashier's own limit (% of the pre-discount subtotal).
      if (ctx.user && computed.discountAmount > 0) {
        if (!hasPerm(ctx.user, 'discount')) {
          throw Object.assign(new Error("You don't have permission to give discounts"), { status: 403, code: 'PERMISSION_DENIED' });
        }
        const cap = ctx.user.role === 'admin' ? null : ctx.user.maxDiscountPercent;
        if (cap != null && computed.subtotal > 0 && (computed.discountAmount / computed.subtotal) * 100 > cap + 1e-9) {
          throw Object.assign(new Error(`Your discount limit is ${cap}% of the bill`), { status: 403, code: 'DISCOUNT_LIMIT' });
        }
      }

      // --- Returns processed as part of this bill --------------------------
      // Each returned line is validated against its ORIGINAL invoice: the item
      // must belong to that invoice and the quantity can't exceed what's still
      // returnable (sold minus already returned). The refund defaults to what
      // was originally charged for that quantity and can only be lowered, never
      // raised above it — you can't refund more than the customer paid.
      let returnValue = 0;
      const restock = new Map();
      const returnRecords = [];
      const returnSerials = [];
      for (const grp of body.returns) {
        const original = await tx.invoice.findUnique({ where: { id: grp.invoiceId }, include: { items: true } });
        if (!original) throw Object.assign(new Error(`Invoice ${grp.invoiceId} not found for return`), { status: 404 });
        const itemMap = new Map(original.items.map((it) => [it.id, it]));
        const lines = [];
        let groupRefund = 0;
        for (const rl of grp.items) {
          const invItem = itemMap.get(rl.invoiceItemId);
          if (!invItem) throw Object.assign(new Error('Return item not found on that invoice'), { status: 404 });
          const already = await tx.returnItem.aggregate({
            where: { invoiceItemId: invItem.id },
            _sum: { quantity: true },
          });
          const returnable = invItem.quantity - (already._sum.quantity || 0);
          if (rl.quantity > returnable + 1e-9) {
            throw Object.assign(new Error(`Only ${returnable} of "${invItem.name}" can still be returned`), { status: 409 });
          }
          const maxRefund = round2((invItem.total / invItem.quantity) * rl.quantity);
          const refund = rl.refundAmount != null ? round2(Math.min(Math.max(0, rl.refundAmount), maxRefund)) : maxRefund;
          groupRefund = round2(groupRefund + refund);
          returnValue = round2(returnValue + refund);
          restock.set(invItem.productId, (restock.get(invItem.productId) || 0) + rl.quantity);
          const prod = await tx.product.findUnique({ where: { id: invItem.productId }, select: { trackSerial: true } });
          if (prod?.trackSerial) {
            const sers = (rl.serials || []).map(normalizeSerial);
            if (sers.length !== rl.quantity) {
              throw Object.assign(new Error(`Returning "${invItem.name}" needs ${rl.quantity} serial/IMEI number(s)`), { status: 400 });
            }
            const sold = await tx.serialUnit.findMany({ where: { serial: { in: sers }, invoiceItemId: invItem.id, status: 'SOLD' } });
            if (sold.length !== sers.length) {
              throw Object.assign(new Error(`Some serials were not sold on that invoice line for "${invItem.name}"`), { status: 409 });
            }
            returnSerials.push(...sold.map((u) => ({ id: u.id, invoiceId: original.id })));
          }
          lines.push({
            invoiceItemId: invItem.id,
            productId: invItem.productId,
            name: invItem.name,
            quantity: rl.quantity,
            refundAmount: refund,
          });
        }
        returnRecords.push({ invoiceId: original.id, customerId: original.customerId, groupRefund, lines });
      }

      // --- Store credit the customer spends on this bill -------------------
      // Capped at the balance AND at what's still owed after returns, so
      // credit only ever reduces the payable — it can never be cashed out by
      // "spending" more of it than the purchase is worth.
      let creditApplied = 0;
      if (body.creditApplied > 0) {
        if (!customer) throw Object.assign(new Error('A customer is required to use store credit'), { status: 400 });
        creditApplied = round2(Math.min(body.creditApplied, customer.creditBalance, Math.max(0, saleTotal - returnValue)));
      }

      // Net the returns and any spent credit against the sale. A positive net
      // is what the customer still pays; a negative net is money owed back.
      const netBill = round2(saleTotal - returnValue - creditApplied);
      const payable = round2(Math.max(0, netBill));
      const grossRefund = round2(Math.max(0, -netBill));
      let refundMode = null;
      if (grossRefund > 0) {
        refundMode = body.refundMode;
        if (refundMode === 'CREDIT' && !customer) {
          throw Object.assign(new Error('A customer is required to keep a refund as store credit'), { status: 400 });
        }
      }

      // Old due the customer wants cleared on this bill, capped at what they
      // actually owe (never raised by anything the client sends).
      let duePaidIntent = 0;
      if (body.duePaid > 0) {
        if (!customer) {
          throw Object.assign(new Error('A customer (with phone number) is required to clear a previous due'), { status: 400 });
        }
        duePaidIntent = round2(Math.min(body.duePaid, customer.totalDue));
      }

      // Every source of money on this bill goes into ONE pool before being
      // allocated, in order: goods first, then the old due, then whatever's
      // left goes back to the customer as change/refund. Pooling the gross
      // refund together with tendered cash is the key fix here — a customer
      // returning something worth more than what they're buying can have
      // that refund fund an old-due clearance directly, with no fresh cash
      // changing hands. The previous version only pulled from tendered cash,
      // so a due-clear requested on a pure-return bill (nothing to "tender")
      // silently never applied — the balance just sat there unchanged.
      if (verifiedTerminal && verifiedTerminal.amount + 0.005 < payable) {
        throw Object.assign(new Error(`Card payment (${verifiedTerminal.amount}) is less than the bill (${payable})`), { status: 402 });
      }
      const paymentMethod = verifiedTerminal ? 'CARD' : body.paymentMethod;
      const tenderedCash = paymentMethod === 'CASH' ? body.amountPaid : payable + duePaidIntent;
      const pool = round2(tenderedCash + grossRefund);
      const amountPaid = round2(Math.min(pool, payable));

      // Foreign-currency tender: record what the customer handed over in
      // their currency at the server's own rate.
      let fxFields = {};
      if (body.payCurrency && body.payCurrency !== settings.currencyCode) {
        const rate = parseRates(settings)[body.payCurrency];
        if (!rate) throw Object.assign(new Error(`No exchange rate set for ${body.payCurrency}`), { status: 400 });
        fxFields = { payCurrency: body.payCurrency, payRate: rate, payAmount: round2(amountPaid / rate) };
      }
      const afterGoods = round2(Math.max(0, pool - amountPaid));
      const previousDuePaid = round2(Math.min(duePaidIntent, afterGoods));
      const leftover = round2(Math.max(0, afterGoods - previousDuePaid));
      // Only ever one of these is nonzero: a change-y "leftover" reads as
      // GST/receipt "Change" on an ordinary purchase, and as "Refund" on a
      // bill whose net was a return/credit overage.
      const changeDue = grossRefund > 0 ? 0 : leftover;
      const refundValue = grossRefund > 0 ? leftover : 0;

      // Paying short of the net payable becomes a new due — needs a customer.
      const dueAmount = round2(Math.max(0, payable - amountPaid));
      if (dueAmount > 0 && !customer) {
        throw Object.assign(
          new Error('A customer (with phone number) is required to record a due/partial-payment amount'),
          { status: 400 }
        );
      }

      const openShift = ctx.user ? await tx.shift.findFirst({ where: { userId: ctx.user.id, closedAt: null }, select: { id: true } }) : null;
      const invoiceNumber = await nextInvoiceNumber(tx);
      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: customer?.id ?? null,
          customerName: body.customerName || customer?.name || 'Walk-in Customer',
          customerPhone: body.customerPhone || null,
          subtotal: computed.subtotal,
          discountType: computed.discountType,
          discountValue: computed.discountValue,
          discountAmount: computed.discountAmount,
          taxAmount: computed.taxAmount,
          loyaltyDiscount: computed.loyaltyDiscount,
          totalAmount: computed.totalAmount,
          paymentMethod,
          paymentRef: verifiedTerminal?.id ?? null,
          customerGstin: body.customerGstin || null,
          ...fxFields,
          amountPaid,
          changeDue,
          dueAmount,
          previousDuePaid,
          returnValue,
          creditApplied,
          refundValue,
          refundMode,
          pointsRedeemed: computed.pointsRedeemed,
          pointsEarned: computed.pointsEarned,
          source: ctx.source || 'POS',
          externalRef: body.externalRef ?? null,
          apiKeyId: ctx.apiKeyId ?? null,
          cashierName: ctx.cashierName ?? null,
          shiftId: openShift?.id ?? null,
          items: { create: computed.items.map((it, i) => ({ ...it, warrantyMonths: lines[i].product.warrantyMonths || 0, costPrice: lines[i].product.purchasePrice || 0 })) },
        },
        include: { items: true },
      });

      const soldAt = new Date();
      for (const plan of serialPlan) {
        const invItem = created.items[plan.lineIndex];
        const months = lines[plan.lineIndex].product.warrantyMonths || 0;
        const warrantyEndsAt = months > 0 ? addMonths(soldAt, months) : null;
        for (const u of plan.units) {
          await tx.serialUnit.update({
            where: { id: u.id },
            data: { status: 'SOLD', invoiceItemId: invItem.id, soldAt, warrantyEndsAt },
          });
          await tx.serialEvent.create({ data: { serialId: u.id, type: 'SOLD', invoiceId: created.id, note: invoiceNumber } });
        }
      }
      for (const rs of returnSerials) {
        await tx.serialUnit.update({
          where: { id: rs.id },
          data: { status: 'IN_STOCK', invoiceItemId: null, soldAt: null, warrantyEndsAt: null },
        });
        await tx.serialEvent.create({ data: { serialId: rs.id, type: 'RETURNED', invoiceId: rs.invoiceId, note: invoiceNumber } });
      }

      if (previousDuePaid > 0) {
        await tx.customerDuePayment.create({
          data: { customerId: customer.id, amount: previousDuePaid, note: `Bill ${invoiceNumber}` },
        });
      }

      // Persist the returns (audit trail) and restock the returned units.
      for (const rr of returnRecords) {
        await tx.return.create({
          data: {
            invoiceId: rr.invoiceId,
            customerId: rr.customerId,
            totalRefund: rr.groupRefund,
            refundMethod: refundValue > 0 ? refundMode : 'BILL_OFFSET',
            note: `Bill ${invoiceNumber}`,
            items: { create: rr.lines },
          },
        });
      }
      for (const [productId, qty] of restock) {
        await tx.product.update({ where: { id: productId }, data: { stock: { increment: qty } } });
      }

      for (const item of body.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      if (customer) {
        // totalDue ("udhaar") and creditBalance are the running balances the
        // POS reads back on the customer's next visit. They used to be kept
        // with Prisma `increment`, which performs the addition inside SQLite's
        // REAL (float) column — so tiny binary rounding residue accumulated
        // across many bills and a fully-paid customer could keep showing e.g.
        // Rs. 0.00…03 still owing that never cleared, and reappeared on the
        // next bill. Compute the new balances in JS and round to paise so the
        // stored value is always clean (round2 collapses sub-paise noise to
        // exactly 0). Safe read-modify-write: we're inside the checkout
        // $transaction and already hold this customer row.
        const newTotalDue = round2(customer.totalDue + dueAmount - previousDuePaid);
        const creditDelta = (refundMode === 'CREDIT' ? refundValue : 0) - creditApplied;
        const newCredit = round2(customer.creditBalance + creditDelta);
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            loyaltyPoints: { increment: computed.pointsEarned - computed.pointsRedeemed },
            totalSpent: round2(customer.totalSpent + computed.totalAmount),
            totalDue: newTotalDue,
            creditBalance: newCredit,
            visits: { increment: 1 },
          },
        });
      }

      return { created, restockProductIds: [...restock.keys()] };
    });

    const { created: invoice, restockProductIds } = result;

    // Linked storefront webhooks (stock changed) — outside the transaction and
    // never awaited; see lib/webhooks.js.
    const touched = [...new Set([...body.items.map((i) => i.productId), ...restockProductIds])];
    if (touched.length > 0) {
      prisma.product
        .findMany({ where: { id: { in: touched }, sku: { not: null } } })
        .then((products) => notifyStockChange(products.map((p) => ({ sku: p.sku, stock: p.stock }))))
        .catch((err) => console.error('post-checkout stock webhook lookup failed', err));
    }
    return { invoice, deduplicated: false };
  }
}

module.exports = { checkoutSchema, performCheckout };
