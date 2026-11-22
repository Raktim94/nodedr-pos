import { round2 } from "./format.ts";

export interface SettleInput {
  /** Sale total after discounts and tax (from quoteSale). */
  saleTotal: number;
  /** Refund value of the returns queued on this bill. */
  returnTotal: number;
  /** Store credit the customer has, and whether the cashier is spending it. */
  creditAvail: number;
  useCredit: boolean;
  /** Old due being folded into this bill (already capped at what is owed). */
  dueToClear: number;
  paymentMethod: string;
  /** Cash handed over, as typed (CASH only). */
  amountPaid: string | number;
}

// Mirrors backend/src/routes/invoices.js: every source of money on the bill
// (tendered cash, and any gross refund from returns/credit) goes into one
// pool, allocated goods first, then the old due, then whatever is left is
// change or refund. Positive net bill → the customer pays; negative → the shop
// owes them.
export function settleBill(i: SettleInput) {
  const creditUse = i.useCredit ? round2(Math.min(i.creditAvail, Math.max(0, i.saleTotal - i.returnTotal))) : 0;
  const netBill = round2(i.saleTotal - i.returnTotal - creditUse);
  const payable = Math.max(0, netBill);
  const grossRefund = Math.max(0, round2(-netBill));

  const tenderedCash = i.paymentMethod === "CASH" ? Number(i.amountPaid) || 0 : payable + i.dueToClear;
  const pool = round2(tenderedCash + grossRefund);
  const amountAppliedToGoods = round2(Math.min(pool, payable));
  const afterGoods = round2(Math.max(0, pool - amountAppliedToGoods));
  const duePaidFinal = round2(Math.min(i.dueToClear, afterGoods));
  const leftover = round2(Math.max(0, afterGoods - duePaidFinal));
  const changeDue = grossRefund > 0 ? 0 : leftover;
  const refundValue = grossRefund > 0 ? leftover : 0;

  // "Paid in full" convenience total: goods + due, assuming fresh cash rather
  // than drawing the due-clear out of a refund.
  const collectTotal = round2(payable + i.dueToClear);
  const shortNow =
    i.paymentMethod === "CASH" && Number(i.amountPaid) > 0 && grossRefund === 0
      ? Math.max(0, round2(collectTotal - (Number(i.amountPaid) || 0)))
      : 0;

  return { creditUse, netBill, payable, grossRefund, tenderedCash, amountAppliedToGoods, duePaidFinal, changeDue, refundValue, collectTotal, shortNow };
}
