// Shared with ReceiptActions.tsx (manual Print button) and the POS page's
// auto-print-after-sale option, so both go through the exact same flow: a
// new tab that self-triggers window.print() (see backend/src/lib/receipt.js)
// — the browser's own print dialog handles printer selection.
export function openReceiptPrint(invoiceId: number) {
  window.open(`/api/print/${invoiceId}/receipt`, "_blank", "noopener,noreferrer");
}
