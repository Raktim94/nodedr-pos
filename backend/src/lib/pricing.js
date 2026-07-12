// Pure pricing math for a sale. Kept separate from the route so it can be
// reasoned about and unit-tested in isolation.
//
// Model:
//   - `sellingPrice` is the product's MRP. Under India's Legal Metrology
//     (Packaged Commodities) Rules, MRP is legally required to be
//     GST-INCLUSIVE — a retailer cannot charge above MRP, and GST is a
//     component of it, not an amount added on top. So the price entered on
//     a product is what the customer pays per unit; GST is backed OUT of
//     it for display/compliance (CGST/SGST breakup), never added on.
//   - A product may carry a standing discount (a markdown set on the
//     product itself, either a percent or a flat currency amount) —
//     applied first, so the line's effective MRP is already discounted
//     before anything else happens.
//   - Each line has a base = effective MRP * quantity (still tax-inclusive).
//   - An order-level manual discount (from the POS discount field) is
//     applied to the inclusive subtotal, then prorated across lines by
//     their share of the subtotal — same proration design as before, just
//     operating on inclusive amounts throughout instead of exclusive ones.
//   - GST (CGST/SGST) shown on the receipt is backed out of each line's
//     post-discount inclusive amount using that line's own rate, purely
//     for the legally-required tax breakup — it does NOT get added to
//     reach the total, because it was never excluded from `sellingPrice`
//     in the first place.
//   - Loyalty points redeemed convert to a further cash discount at
//     settings.pointValue, capped so the total never goes below zero.
//   - Points earned accrue on the final payable amount.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// A product's own standing discount (set in Inventory) — either a percent
// or a flat currency amount off its MRP. Shared with frontend/lib/quote.ts,
// which must compute this identically for the POS live-preview to match.
function effectivePrice(product) {
  const { discountType, discountValue } = product;
  if (!discountType || !discountValue) return product.sellingPrice;
  if (discountType === 'percent') {
    const pct = Math.min(100, Math.max(0, discountValue));
    return round2(product.sellingPrice * (1 - pct / 100));
  }
  const amt = Math.min(product.sellingPrice, Math.max(0, discountValue));
  return round2(product.sellingPrice - amt);
}

/**
 * @param {Array<{product, quantity}>} lines  product = catalog row (authoritative price/tax)
 * @param {object} opts { discountType, discountValue, pointsRedeemed, settings }
 * @returns computed invoice fields + per-line breakdown
 */
function computeSale(lines, opts) {
  const { discountType = null, discountValue = 0, pointsRedeemed = 0, settings } = opts;

  const gstEnabled = !!settings?.gstEnabled;

  const effectivePrices = lines.map((l) => effectivePrice(l.product));
  // MRP-inclusive line totals — this IS what the customer pays before any
  // order-level discount, not a pre-tax figure to add GST onto.
  const bases = lines.map((l, i) => round2(effectivePrices[i] * l.quantity));
  const subtotal = round2(bases.reduce((a, b) => a + b, 0));

  // Manual order-level discount, taken off the inclusive subtotal — this
  // way both "% off" and a flat "amount off" mean exactly what a cashier
  // and customer expect: a discount off the ticket price, not off some
  // internal tax-exclusive figure the customer never sees.
  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = round2(subtotal * (Math.min(discountValue, 100) / 100));
  } else if (discountType === 'amount') {
    discountAmount = round2(Math.min(discountValue, subtotal));
  }
  discountAmount = Math.max(0, Math.min(discountAmount, subtotal));

  // Prorate the discount, then back GST out of each line's post-discount
  // inclusive amount (informational — it's a component, not an addition).
  const items = lines.map((l, i) => {
    const base = bases[i];
    const share = subtotal > 0 ? base / subtotal : 0;
    const lineDiscount = round2(discountAmount * share);
    const discountedBase = round2(base - lineDiscount); // still inclusive — the actual line charge
    const rate = gstEnabled ? l.product.taxRate || 0 : 0;
    const taxAmount = rate > 0 ? round2(discountedBase - discountedBase / (1 + rate / 100)) : 0;
    return {
      productId: l.product.id,
      name: l.product.name,
      unit: l.product.unit || null,
      quantity: l.quantity,
      price: effectivePrices[i],
      taxRate: rate,
      taxAmount,
      total: discountedBase, // inclusive — GST is already inside this, not added to it
    };
  });

  const taxAmount = round2(items.reduce((a, it) => a + it.taxAmount, 0));

  // Loyalty redemption
  const loyaltyEnabled = !!settings?.loyaltyEnabled;
  const pointValue = loyaltyEnabled ? settings.pointValue || 0 : 0;
  const preLoyaltyTotal = round2(subtotal - discountAmount);
  const redeemPoints = loyaltyEnabled ? Math.max(0, Math.floor(pointsRedeemed)) : 0;
  let loyaltyDiscount = round2(redeemPoints * pointValue);
  if (loyaltyDiscount > preLoyaltyTotal) loyaltyDiscount = preLoyaltyTotal;

  const totalAmount = round2(preLoyaltyTotal - loyaltyDiscount);

  const pointsPerUnit = loyaltyEnabled ? settings.pointsPerUnit || 0 : 0;
  const pointsEarned = loyaltyEnabled ? Math.floor(totalAmount * pointsPerUnit) : 0;

  return {
    subtotal,
    discountType: discountType || null,
    discountValue: discountType ? discountValue : 0,
    discountAmount,
    taxAmount,
    loyaltyDiscount,
    totalAmount,
    pointsRedeemed: redeemPoints,
    pointsEarned,
    items,
  };
}

module.exports = { computeSale, round2 };
