const { round2 } = require('./pricing');

// What a bill nets to once returns and spent store credit are taken off the
// sale. Positive net = what the customer still pays; negative = owed back.
function netOfSale({ saleTotal, returnValue, creditApplied }) {
  const netBill = round2(saleTotal - returnValue - creditApplied);
  return { netBill, payable: round2(Math.max(0, netBill)), grossRefund: round2(Math.max(0, -netBill)) };
}

// Every source of money on the bill (cash tendered, and any gross refund from
// returns/credit) goes into ONE pool, allocated goods first, then the old due,
// then whatever is left goes back as change (ordinary sale) or refund (a bill
// whose net was a return overage). Pooling the refund lets a return worth more
// than the purchase fund an old-due clearance with no fresh cash changing hands.
// Frontend mirror: frontend/lib/settle.ts.
function allocateTender({ payable, grossRefund, duePaidIntent, tenderedCash }) {
  const pool = round2(tenderedCash + grossRefund);
  const amountPaid = round2(Math.min(pool, payable));
  const afterGoods = round2(Math.max(0, pool - amountPaid));
  const previousDuePaid = round2(Math.min(duePaidIntent, afterGoods));
  const leftover = round2(Math.max(0, afterGoods - previousDuePaid));
  return {
    amountPaid,
    previousDuePaid,
    changeDue: grossRefund > 0 ? 0 : leftover,
    refundValue: grossRefund > 0 ? leftover : 0,
    // Paying short of the payable becomes a new due.
    dueAmount: round2(Math.max(0, payable - amountPaid)),
  };
}

module.exports = { netOfSale, allocateTender };
