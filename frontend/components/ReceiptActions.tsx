import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { openReceiptPrint } from "@/lib/print";

// Printing goes through the browser's own print dialog (loaded into a
// hidden in-page iframe, no new tab — see lib/print.ts) so the user picks
// whichever printer the OS/CUPS has configured — thermal, laser, or "Save
// as PDF". No USB device, no driver bundled with the app. "Download PDF"
// hits a separate endpoint that generates a real PDF file to save.
export function ReceiptActions({ invoiceId, className }: { invoiceId: number; className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-2 ${className || ""}`}>
      <Button type="button" variant="secondary" onClick={() => openReceiptPrint(invoiceId)}>
        <Printer className="h-4 w-4" aria-hidden="true" />
        Print
      </Button>
      <a href={`/api/print/${invoiceId}/pdf`} download className="contents">
        <Button type="button" variant="secondary" className="w-full">
          <Download className="h-4 w-4" aria-hidden="true" />
          Download PDF
        </Button>
      </a>
    </div>
  );
}
