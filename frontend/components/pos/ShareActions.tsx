"use client";

import { FileText, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/components/I18nProvider";
import { api, ApiError } from "@/lib/api";

// WhatsApp the receipt (no WhatsApp Business account needed — it opens the
// cashier's own WhatsApp with the bill and a signed PDF link pre-filled) and
// download the A4 tax invoice.
export function ShareActions({ invoiceId, phone }: { invoiceId: number; phone?: string | null }) {
  const { show } = useToast();
  const { t } = useTranslation();

  async function whatsapp() {
    try {
      const r = await api.get<{ whatsappUrl: string; hasPhone: boolean }>(`/payments/share/${invoiceId}${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`);
      if (!r.hasPhone) show(t("share.noPhone"), "info");
      window.open(r.whatsappUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      show(e instanceof ApiError ? e.message : t("share.prepareFailed"), "error");
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={whatsapp}>
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        {t("share.whatsapp")}
      </Button>
      <a href={`/api/print/${invoiceId}/pdf?layout=a4`} download className="contents">
        <Button type="button" variant="secondary">
          <FileText className="h-4 w-4" aria-hidden="true" />
          {t("share.a4")}
        </Button>
      </a>
    </>
  );
}
