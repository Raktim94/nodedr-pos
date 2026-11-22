import { test } from "node:test";
import assert from "node:assert/strict";
import { settleBill } from "../lib/settle.ts";

const base = { saleTotal: 100, returnTotal: 0, creditAvail: 0, useCredit: false, dueToClear: 0, paymentMethod: "CASH", amountPaid: "" as string | number };

test("plain cash sale: change is what is tendered above the total", () => {
  const r = settleBill({ ...base, amountPaid: 150 });
  assert.deepEqual([r.payable, r.changeDue, r.refundValue, r.shortNow], [100, 50, 0, 0]);
});

test("cash short of the total reports how much is still owed", () => {
  const r = settleBill({ ...base, amountPaid: "60" });
  assert.deepEqual([r.changeDue, r.shortNow], [0, 40]);
});

test("UPI/CARD are paid in full: no change, nothing short", () => {
  const r = settleBill({ ...base, paymentMethod: "UPI" });
  assert.deepEqual([r.tenderedCash, r.changeDue, r.shortNow], [100, 0, 0]);
});

test("store credit only reduces the payable and never exceeds sale minus returns", () => {
  assert.equal(settleBill({ ...base, creditAvail: 30, useCredit: true, paymentMethod: "UPI" }).payable, 70);
  assert.equal(settleBill({ ...base, creditAvail: 500, useCredit: true, paymentMethod: "UPI" }).payable, 0);
  assert.equal(settleBill({ ...base, returnTotal: 80, creditAvail: 500, useCredit: true, paymentMethod: "UPI" }).creditUse, 20);
  assert.equal(settleBill({ ...base, creditAvail: 30, useCredit: false, paymentMethod: "UPI" }).creditUse, 0);
});

test("returns worth more than the sale become a refund to the customer", () => {
  const r = settleBill({ ...base, returnTotal: 130, amountPaid: 0 });
  assert.deepEqual([r.payable, r.grossRefund, r.refundValue, r.changeDue], [0, 30, 30, 0]);
});

test("a refund is pooled with cash so it can clear the customer's old due first", () => {
  const r = settleBill({ ...base, returnTotal: 130, dueToClear: 20, amountPaid: 0 });
  assert.deepEqual([r.grossRefund, r.duePaidFinal, r.refundValue], [30, 20, 10]);
});

test("cash tendered pays goods first, then the old due, then is change", () => {
  const r = settleBill({ ...base, dueToClear: 40, amountPaid: 200 });
  assert.deepEqual([r.amountAppliedToGoods, r.duePaidFinal, r.changeDue, r.collectTotal], [100, 40, 60, 140]);
  const partial = settleBill({ ...base, dueToClear: 40, amountPaid: 120 });
  assert.deepEqual([partial.duePaidFinal, partial.changeDue, partial.shortNow], [20, 0, 20]);
});

test("money is rounded to cents", () => {
  const r = settleBill({ ...base, saleTotal: 0.1 + 0.2, amountPaid: 1 });
  assert.equal(r.changeDue, 0.7);
});
