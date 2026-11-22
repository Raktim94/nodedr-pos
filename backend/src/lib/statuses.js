// The status vocabularies stored in the database, in one place. The writers
// (routes, sync, checkout) and the readers (filters, the web UI's columns)
// must agree on these strings.

const ORDER_STATUS = { NEW: 'NEW', PACKING: 'PACKING', READY: 'READY', COLLECTED: 'COLLECTED', CANCELLED: 'CANCELLED' };
const ORDER_STATUSES = Object.values(ORDER_STATUS);
// An order still being worked: it can be moved, cancelled or handed over.
const OPEN_ORDER_STATUSES = [ORDER_STATUS.NEW, ORDER_STATUS.PACKING, ORDER_STATUS.READY];
const ORDER_TRANSITIONS = {
  NEW: ['PACKING', 'READY', 'CANCELLED'],
  PACKING: ['READY', 'CANCELLED'],
  READY: ['CANCELLED'],
};

// Branch-to-branch stock transfer: PENDING -> SHIPPED (sender) -> RECEIVED (receiver).
const TRANSFER_STATUS = { PENDING: 'PENDING', SHIPPED: 'SHIPPED', RECEIVED: 'RECEIVED' };

const PURCHASE_ORDER_STATUS = { DRAFT: 'DRAFT', SENT: 'SENT', RECEIVED: 'RECEIVED', CANCELLED: 'CANCELLED' };
const PURCHASE_ORDER_STATUSES = Object.values(PURCHASE_ORDER_STATUS);
// A purchase order that can no longer be received or cancelled.
const isPurchaseOrderClosed = (status) => status === PURCHASE_ORDER_STATUS.RECEIVED || status === PURCHASE_ORDER_STATUS.CANCELLED;

module.exports = {
  ORDER_STATUS, ORDER_STATUSES, OPEN_ORDER_STATUSES, ORDER_TRANSITIONS,
  TRANSFER_STATUS,
  PURCHASE_ORDER_STATUS, PURCHASE_ORDER_STATUSES, isPurchaseOrderClosed,
};
