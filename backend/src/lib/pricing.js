// Pure pricing math for a sale. Kept separate from the route so it can be
// reasoned about and unit-tested in isolation.
//
// Model:
//   - Each line has a base = unit price * quantity (tax-exclusive).
//   - An order-level manual discount is applied to the subtotal, then
//     prorated across lines by their share of the subtotal so each line's
//     GST is computed on its discounted base (correct per-product tax).
//   - Loyalty points redeemed convert to a further cash discount at
//     settings.pointValue, capped so the total never goes below zero.
//   - Points earned accrue on the final payable amount.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * @param {Array<{product, quantity}>} lines  product = catalog row (authoritative price/tax)
 * @param {object} opts { discountType, discountValue, pointsRedeemed, settings }
 * @returns computed invoice fields + per-line breakdown
 */
function computeSale(lines, opts) {
  const { discountType = null, discountValue = 0, pointsRedeemed = 0, settings } = opts;

  const gstEnabled = !!settings?.gstEnabled;

  const bases = lines.map((l) => round2(l.product.sellingPrice * l.quantity));
  const subtotal = round2(bases.reduce((a, b) => a + b, 0));

  // Manual order-level discount
  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = round2(subtotal * (Math.min(discountValue, 100) / 100));
  } else if (discountType === 'amount') {
    discountAmount = round2(Math.min(discountValue, subtotal));
  }
  discountAmount = Math.max(0, Math.min(discountAmount, subtotal));

  // Prorate discount and compute per-line tax on the discounted base
  const items = lines.map((l, i) => {
    const base = bases[i];
    const share = subtotal > 0 ? base / subtotal : 0;
    const lineDiscount = round2(discountAmount * share);
    const discountedBase = round2(base - lineDiscount);
    const rate = gstEnabled ? l.product.taxRate || 0 : 0;
    const taxAmount = round2(discountedBase * (rate / 100));
    return {
      productId: l.product.id,
      name: l.product.name,
      quantity: l.quantity,
      price: l.product.sellingPrice,
      taxRate: rate,
      taxAmount,
      total: round2(discountedBase + taxAmount),
    };
  });

  const taxAmount = round2(items.reduce((a, it) => a + it.taxAmount, 0));

  // Loyalty redemption
  const loyaltyEnabled = !!settings?.loyaltyEnabled;
  const pointValue = loyaltyEnabled ? settings.pointValue || 0 : 0;
  const preLoyaltyTotal = round2(subtotal - discountAmount + taxAmount);
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
