const test = require('node:test');
const assert = require('node:assert/strict');
const { netOfSale, allocateTender } = require('../src/lib/settlement');

test('netOfSale: returns and credit come off the sale; a negative net is a refund owed', () => {
  assert.deepEqual(netOfSale({ saleTotal: 100, returnValue: 30, creditApplied: 20 }), { netBill: 50, payable: 50, grossRefund: 0 });
  assert.deepEqual(netOfSale({ saleTotal: 100, returnValue: 130, creditApplied: 0 }), { netBill: -30, payable: 0, grossRefund: 30 });
  assert.equal(netOfSale({ saleTotal: 0.1 + 0.2, returnValue: 0, creditApplied: 0 }).payable, 0.3);
});

test('allocateTender: goods first, then the old due, then change', () => {
  assert.deepEqual(allocateTender({ payable: 100, grossRefund: 0, duePaidIntent: 40, tenderedCash: 200 }), { amountPaid: 100, previousDuePaid: 40, changeDue: 60, refundValue: 0, dueAmount: 0 });
});

test('allocateTender: paying short leaves a new due and clears none of the old', () => {
  assert.deepEqual(allocateTender({ payable: 100, grossRefund: 0, duePaidIntent: 40, tenderedCash: 60 }), { amountPaid: 60, previousDuePaid: 0, changeDue: 0, refundValue: 0, dueAmount: 40 });
});

test('allocateTender: a refund is pooled with cash so it can clear the old due before refunding the rest', () => {
  assert.deepEqual(allocateTender({ payable: 0, grossRefund: 30, duePaidIntent: 20, tenderedCash: 0 }), { amountPaid: 0, previousDuePaid: 20, changeDue: 0, refundValue: 10, dueAmount: 0 });
});
