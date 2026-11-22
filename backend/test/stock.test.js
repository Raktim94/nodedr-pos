const test = require('node:test');
const assert = require('node:assert/strict');
const { lacksStock, writeStockLevel } = require('../src/lib/stock');

test('lacksStock: refuses oversells unless the shop allows negative stock', () => {
  assert.equal(lacksStock({ allowNegativeStock: false }, 5, 5), false);
  assert.equal(lacksStock({ allowNegativeStock: false }, 5, 5.0001), true);
  assert.equal(lacksStock({ allowNegativeStock: false }, 0.1 + 0.2, 0.3), false); // float dust is not a shortage
  assert.equal(lacksStock({ allowNegativeStock: true }, 0, 99), false);
  assert.equal(lacksStock(null, 1, 2), true); // no settings row: the strict rule applies
});

// writeStockLevel only needs a tx exposing shopSettings.findFirst and product.update.
const fakeTx = (allowNegativeStock) => {
  const updates = [];
  return {
    updates,
    shopSettings: { findFirst: async () => ({ allowNegativeStock }) },
    product: { update: async (args) => (updates.push(args), { id: args.where.id, stock: args.data.stock }) },
  };
};

test('writeStockLevel: writes non-negative levels without consulting settings rules', async () => {
  const tx = fakeTx(false);
  assert.deepEqual(await writeStockLevel(tx, { id: 7 }, 12, 'no'), { id: 7, stock: 12 });
  assert.deepEqual(await writeStockLevel(tx, { id: 7 }, 0, 'no'), { id: 7, stock: 0 });
});

test('writeStockLevel: a negative level is a 409 with the caller message, or clamps to 0 when allowed', async () => {
  await assert.rejects(writeStockLevel(fakeTx(false), { id: 7 }, -1, 'Insufficient stock (have 0)'), (e) => e.status === 409 && e.message === 'Insufficient stock (have 0)');
  const tx = fakeTx(true);
  assert.deepEqual(await writeStockLevel(tx, { id: 7 }, -3, 'no'), { id: 7, stock: 0 });
});
