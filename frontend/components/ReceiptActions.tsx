"use client";

import { useState } from "react";
import { Download, Printer, Usb } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { openReceiptPrint } from "@/lib/print";
import { api, ApiError } from "@/lib/api";

// Two printing paths, deliberately kept side by side rather than one
// replacing the other:
//   - Print / Download PDF go through the browser's own print dialog or a
//     generated PDF file — no USB device, no driver bundled with the app,
//     works with whatever printer the OS/CUPS has configured.
//   - Print via USB sends raw ESC/POS bytes straight to a USB thermal
//     printer (see backend/src/lib/escposUsb.js) — no print dialog, no
//     "Save as PDF" detour, just the receipt cutting off the roll. Requires
//     the backend's USB device passthrough (see docker-compose.yml).
export function ReceiptActions({ invoiceId, className }: { invoiceId: number; className?: string }) {
  const { show } = useToast();
  const [printingUsb, setPrintingUsb] = useState(false);

  async function printViaUsb() {
    setPrintingUsb(true);
    try {
      await api.post(`/print/${invoiceId}/usb`);
      show("Sent to USB printer", "success");
    } catch (err) {
      show(
        err instanceof ApiError
          ? err.message
          : "Could not print to USB printer",
        "error"
      );
    } finally {
      setPrintingUsb(false);
    }
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className || ""}`}>
      <Button type="button" variant="secondary" onClick={() => openReceiptPrint(invoiceId)}>
        <Printer className="h-4 w-4" aria-hidden="true" />
        Print
      </Button>
      <a href={`/api/print/${invoiceId}/pdf`} download className="contents">
        <Button type="button" variant="secondary">
          <Download className="h-4 w-4" aria-hidden="true" />
          Download PDF
        </Button>
      </a>
      <Button type="button" variant="secondary" onClick={printViaUsb} disabled={printingUsb}>
        <Usb className="h-4 w-4" aria-hidden="true" />
        {printingUsb ? "Printing…" : "Print via USB"}
      </Button>
    </div>
  );
}
