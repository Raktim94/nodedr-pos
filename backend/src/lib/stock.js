const { getSettings } = require('./settings');

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
    throw Object.assign(new Error(insufficientMessage), { status: 409 });
  }
  return tx.product.update({ where: { id: product.id }, data: { stock: Math.max(0, next) } });
}

module.exports = { lacksStock, writeStockLevel };
