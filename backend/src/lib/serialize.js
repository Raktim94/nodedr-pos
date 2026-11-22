const { hasPerm } = require('../middleware/auth');

// What the shop paid for stock is margin data: only staff who manage stock or
// read reports see it. Every response that carries products or sold lines goes
// through here so the rule lives in one place.
const seesPurchaseCost = (user) => hasPerm(user, 'reports') || hasPerm(user, 'inventory');
const seesSoldCost = (user) => hasPerm(user, 'reports');

function productFor(user, product) {
  if (seesPurchaseCost(user)) return product;
  const { purchasePrice, ...rest } = product;
  return rest;
}

function invoiceFor(user, invoice) {
  if (!invoice?.items || seesSoldCost(user)) return invoice;
  return { ...invoice, items: invoice.items.map(({ costPrice, ...rest }) => rest) };
}

module.exports = { productFor, invoiceFor };
