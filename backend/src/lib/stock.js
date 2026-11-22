const { getSettings } = require('./settings');

const { httpError } = require('./http');
// The one place that decides whether stock may go below what is on hand.
// `available` is what can still be taken (on-hand, less anything reserved).
function lacksStock(settings, available, quantity) {
  return !settings?.allowNegativeStock && available + 1e-9 < quantity;
}

// Writes an absolute stock level for a product inside `tx`. A level below
// zero is refused unless the shop allows negative stock; otherwise it is
// clamped to zero. `insufficientMessage` is the 409 text the caller wants.
async function writeStockLevel(tx, product, next, insufficientMessage) {
  if (next < 0 && !(await getSettings(tx))?.allowNegativeStock) {
    throw httpError(insufficientMessage, 409);
  }
  return tx.product.update({ where: { id: product.id }, data: { stock: Math.max(0, next) } });
}

// Total quantity asked for per product across a bill's lines, so the same
// product repeated on several lines is checked against stock once, as a whole.
function quantityByProduct(items) {
  const totals = new Map();
  for (const { productId, quantity } of items) totals.set(productId, (totals.get(productId) || 0) + quantity);
  return totals;
}

module.exports = { lacksStock, writeStockLevel, quantityByProduct };
