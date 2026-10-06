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
import { api, describeApiError } from "@/lib/api";
import type { ShopSettings } from "@/lib/types";
import { useSaver } from "./useSaver";

// Invoice style, terms and the authorised-signatory signature printed on
// A4 invoices and receipts.
export function InvoiceTab({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const { show } = useToast();
  const qc = useQueryClient();
  const { withPasswordConfirm } = usePasswordConfirm();
  const [layout, setLayout] = useState(settings.invoiceLayout);
  const [signatory, setSignatory] = useState(settings.signatoryName ?? "");
  const [terms, setTerms] = useState(settings.termsText ?? "");
  const [pad, setPad] = useState(false);

  const upload = useMutation({
    mutationFn: (image: string) => withPasswordConfirm("save this signature", (confirmPassword) => api.put("/settings/signature", { image, confirmPassword })),
    onSuccess: (r) => { if (r) { qc.invalidateQueries({ queryKey: ["shop-settings"] }); show("Signature saved", "success"); } setPad(false); },
    onError: (e) => show(describeApiError(e, "Could not save the signature"), "error"),
  });
  const remove = useMutation({
    mutationFn: () => withPasswordConfirm("remove the signature", (confirmPassword) => api.delete("/settings/signature", { confirmPassword })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shop-settings"] }),
  });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold">Bill style</h2>
        <Select label="PDF bill layout" value={layout} onChange={(e) => setLayout(e.target.value as "receipt" | "a4")} options={[{ value: "receipt", label: "Receipt (80 mm thermal style)" }, { value: "a4", label: "A4 tax invoice (letterhead, GST breakup, warranty table)" }]} />
        <Field label="Signatory name (printed under the signature)" value={signatory} onChange={(e) => setSignatory(e.target.value)} maxLength={100} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">Terms &amp; conditions (A4 invoice)
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={600} rows={3} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm" placeholder="e.g. Goods once sold will not be taken back. Warranty as per manufacturer." />
        </label>
        <div><Button onClick={() => save({ invoiceLayout: layout, signatoryName: signatory, termsText: terms })}>Save</Button></div>
        <p className="text-xs text-foreground-muted">You can still download either layout for any bill from Sales or the checkout screen.</p>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold">Authorised signature</h2>
        <p className="text-sm text-foreground-muted">Printed on A4 invoices and receipts. Draw it here or upload an image (PNG/JPEG, up to 300 KB).</p>
        {settings.signatureFile ? (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/signatures/${settings.signatureFile}`} alt="Current signature" className="h-20 rounded-lg border border-border bg-white p-2" />
            <Button variant="ghost" onClick={() => remove.mutate()}><Trash2 className="h-4 w-4 text-danger" aria-hidden="true" /> Remove</Button>
          </div>
        ) : <p className="text-sm text-foreground-muted">No signature yet.</p>}
        <div><Button variant="secondary" onClick={() => setPad(true)}><PenLine className="h-4 w-4" aria-hidden="true" /> {settings.signatureFile ? "Replace signature" : "Add signature"}</Button></div>
      </Card>
      {pad && <SignaturePad title="Authorised signature" onClose={() => setPad(false)} onSave={(d) => upload.mutate(d)} />}
    </div>
  );
}
