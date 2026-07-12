// Shared with ReceiptActions.tsx (manual Print button) and the POS page's
// auto-print-after-sale option, so both go through the exact same flow.
//
// Printing used to open the receipt in a new browser tab, which left a
// blank/finished tab behind that the cashier had to notice and close to get
// back to the register. Instead, this loads the same self-printing HTML
// (see backend/src/lib/receipt.js's `onload="window.print()"`) into a
// hidden same-page iframe: the OS print dialog still opens exactly as
// before (any printer, or "Save as PDF"), but the app never navigates away
// — there's no tab to come back to.
let printFrame: HTMLIFrameElement | null = null;

function getPrintFrame(): HTMLIFrameElement {
  if (printFrame) return printFrame;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Positioned far off-screen rather than display:none/width:0 — a 0-width
  // frame forces the browser to lay out the receipt at 0px before printing,
  // which is what clipped the right-aligned amount columns. A real box (wide
  // enough for the 80mm receipt) lets it lay out normally; the huge negative
  // offset keeps it invisible without affecting layout.
  frame.style.position = "fixed";
  frame.style.top = "-10000px";
  frame.style.left = "-10000px";
  frame.style.width = "380px";
  frame.style.height = "600px";
  frame.style.border = "none";
  document.body.appendChild(frame);
  printFrame = frame;
  return frame;
}

export function openReceiptPrint(invoiceId: number) {
  const frame = getPrintFrame();
  // Print from the PARENT once the receipt has loaded, rather than relying on
  // an inline `onload="window.print()"` inside the receipt document:
  //   - focus() first so the browser prints THIS iframe, not the host page
  //     (some engines print the parent document otherwise);
  //   - doing it here keeps the print() call as close as possible to the
  //     originating click, which matters because browsers gate window.print()
  //     on a recent user gesture.
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      // Fallback: if the cross-frame call is blocked for any reason, ask the
      // receipt document to print itself.
      win.postMessage("print", "*");
    }
  };
  // Force a reload even if printing the same invoice twice in a row.
  frame.src = `/api/print/${invoiceId}/receipt?t=${Date.now()}`;
}
