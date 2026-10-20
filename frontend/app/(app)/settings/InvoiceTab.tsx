"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PenLine, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { SignaturePad } from "@/components/pos/SignaturePad";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useTranslation } from "@/components/I18nProvider";
import { api, describeApiError } from "@/lib/api";
import type { ShopSettings } from "@/lib/types";
import { useSaver } from "./useSaver";

// Invoice style, terms and the authorised-signatory signature printed on
// A4 invoices and receipts.
export function InvoiceTab({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const { show } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { withPasswordConfirm } = usePasswordConfirm();
  const [layout, setLayout] = useState(settings.invoiceLayout);
  const [signatory, setSignatory] = useState(settings.signatoryName ?? "");
  const [terms, setTerms] = useState(settings.termsText ?? "");
  const [pad, setPad] = useState(false);

  const upload = useMutation({
    mutationFn: (image: string) => withPasswordConfirm(t("settings.invoice.confirmSaveSignature"), (confirmPassword) => api.put("/settings/signature", { image, confirmPassword })),
    onSuccess: (r) => { if (r) { qc.invalidateQueries({ queryKey: ["shop-settings"] }); show(t("settings.invoice.signatureSaved"), "success"); } setPad(false); },
    onError: (e) => show(describeApiError(e, t("settings.invoice.signatureSaveFailed")), "error"),
  });
  const remove = useMutation({
    mutationFn: () => withPasswordConfirm(t("settings.invoice.confirmRemoveSignature"), (confirmPassword) => api.delete("/settings/signature", { confirmPassword })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shop-settings"] }),
  });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold">{t("settings.invoice.styleTitle")}</h2>
        <Select label={t("settings.invoice.layoutLabel")} value={layout} onChange={(e) => setLayout(e.target.value as "receipt" | "a4")} options={[{ value: "receipt", label: t("settings.invoice.layoutReceipt") }, { value: "a4", label: t("settings.invoice.layoutA4") }]} />
        <Field label={t("settings.invoice.signatory")} value={signatory} onChange={(e) => setSignatory(e.target.value)} maxLength={100} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t("settings.invoice.termsLabel")}
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={600} rows={3} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm" placeholder={t("settings.invoice.termsPlaceholder")} />
        </label>
        <div><Button onClick={() => save({ invoiceLayout: layout, signatoryName: signatory, termsText: terms })}>{t("settings.invoice.save")}</Button></div>
        <p className="text-xs text-foreground-muted">{t("settings.invoice.layoutNote")}</p>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold">{t("settings.invoice.signatureTitle")}</h2>
        <p className="text-sm text-foreground-muted">{t("settings.invoice.signatureDesc")}</p>
        {settings.signatureFile ? (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/signatures/${settings.signatureFile}`} alt={t("settings.invoice.currentSignature")} className="h-20 rounded-lg border border-border bg-white p-2" />
            <Button variant="ghost" onClick={() => remove.mutate()}><Trash2 className="h-4 w-4 text-danger" aria-hidden="true" /> {t("settings.invoice.remove")}</Button>
          </div>
        ) : <p className="text-sm text-foreground-muted">{t("settings.invoice.noSignature")}</p>}
        <div><Button variant="secondary" onClick={() => setPad(true)}><PenLine className="h-4 w-4" aria-hidden="true" /> {settings.signatureFile ? t("settings.invoice.replaceSignature") : t("settings.invoice.addSignature")}</Button></div>
      </Card>
      {pad && <SignaturePad title={t("settings.invoice.signatureTitle")} onClose={() => setPad(false)} onSave={(d) => upload.mutate(d)} />}
    </div>
  );
}
