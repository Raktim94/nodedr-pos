"use client";

import { FileText, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/lib/api";

// WhatsApp the receipt (no WhatsApp Business account needed — it opens the
// cashier's own WhatsApp with the bill and a signed PDF link pre-filled) and
// download the A4 tax invoice.
export function ShareActions({ invoiceId, phone }: { invoiceId: number; phone?: string | null }) {
  const { show } = useToast();

  async function whatsapp() {
    try {
      const r = await api.get<{ whatsappUrl: string; hasPhone: boolean }>(`/payments/share/${invoiceId}${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`);
      if (!r.hasPhone) show("No customer phone on this bill — pick the contact in WhatsApp", "info");
      window.open(r.whatsappUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Could not prepare the WhatsApp message", "error");
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={whatsapp}>
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        WhatsApp
      </Button>
      <a href={`/api/print/${invoiceId}/pdf?layout=a4`} download className="contents">
        <Button type="button" variant="secondary">
          <FileText className="h-4 w-4" aria-hidden="true" />
          A4 invoice
        </Button>
      </a>
    </>
  );
}
