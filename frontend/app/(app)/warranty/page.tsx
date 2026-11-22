"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, ScanBarcode, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, PageHeader } from "@/components/ui/Bits";
import { api, ApiError, describeApiError } from "@/lib/api";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/components/I18nProvider";
import { warrantyEventKey } from "@/lib/enumLabels";
import type { TranslationKey } from "@/lib/i18n";
import type { WarrantyResult } from "@/lib/types";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const historyLabel = (t: (key: TranslationKey) => string, type: string) => {
  const key = warrantyEventKey(type);
  return key ? t(key) : type.charAt(0) + type.slice(1).toLowerCase();
};

// Scan (or type) an IMEI / serial number: who bought it, when, and whether it
// is still under warranty. A scanner keystroke run works anywhere on the page.
export default function WarrantyPage() {
  const { show } = useToast();
  const { t } = useTranslation();
  const [serial, setSerial] = useState("");
  const [claim, setClaim] = useState("");
  const [result, setResult] = useState<WarrantyResult | null>(null);

  const lookup = useMutation({
    mutationFn: (s: string) => api.get<WarrantyResult>(`/warranty/${encodeURIComponent(s.trim())}`),
    onSuccess: setResult,
    onError: (e) => {
      setResult(null);
      show(e instanceof ApiError && e.status === 404 ? t("warranty.notFound") : describeApiError(e, t("warranty.lookupFailed")), "error");
    },
  });
  const logClaim = useMutation({
    mutationFn: () => api.post(`/warranty/${encodeURIComponent(result!.serial)}/claim`, { note: claim }),
    onSuccess: () => { setClaim(""); show(t("warranty.claimLogged"), "success"); lookup.mutate(result!.serial); },
    onError: (e) => show(describeApiError(e, t("warranty.claimFailed")), "error"),
  });

  useBarcodeScanner({ onScan: (c) => { setSerial(c); lookup.mutate(c); } });

  const w = result;
  const tone = w?.warranty === "ACTIVE" ? "good" : w?.warranty === "EXPIRED" ? "bad" : "warn";
  const Icon = w?.warranty === "ACTIVE" ? ShieldCheck : w?.warranty === "EXPIRED" ? ShieldAlert : ShieldQuestion;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("warranty.title")} subtitle={t("warranty.subtitle")} />
      <form className="card-surface mb-6 flex flex-wrap gap-3 p-4" onSubmit={(e) => { e.preventDefault(); if (serial.trim()) lookup.mutate(serial); }}>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border px-3">
          <ScanBarcode className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
          <input autoFocus value={serial} onChange={(e) => setSerial(e.target.value)} placeholder={t("warranty.serialPlaceholder")} aria-label={t("warranty.serialPlaceholder")} className="w-full bg-transparent py-2.5 font-mono text-sm outline-none" />
        </div>
        <Button type="submit" disabled={lookup.isPending || !serial.trim()}>{lookup.isPending ? t("warranty.checking") : t("warranty.check")}</Button>
      </form>

      {w && (
        <div className="space-y-4">
          <div className={`rise card-surface flex items-center gap-4 p-5 ${w.warranty === "ACTIVE" ? "border-success/40" : ""}`}>
            <Icon className={`h-10 w-10 shrink-0 ${w.warranty === "ACTIVE" ? "text-success" : w.warranty === "EXPIRED" ? "text-danger" : "text-warning"}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold">{w.product.name}</p>
              <p className="font-mono text-sm text-foreground-muted">{w.serial}</p>
            </div>
            <Badge tone={tone}>
              {w.warranty === "ACTIVE" ? t("warranty.under", { count: String(w.daysLeft) }) : w.warranty === "EXPIRED" ? t("warranty.expired") : w.warranty === "RETURNED" ? t("warranty.returned") : t("warranty.noWarranty")}
            </Badge>
          </div>

          <dl className="rise card-surface grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4" style={{ "--i": 1 } as React.CSSProperties}>
            <div><dt className="text-foreground-muted">{t("warranty.soldOn")}</dt><dd className="font-medium">{fmt(w.soldAt)}</dd></div>
            <div><dt className="text-foreground-muted">{t("warranty.ends")}</dt><dd className="font-medium">{fmt(w.warrantyEndsAt)}</dd></div>
            <div><dt className="text-foreground-muted">{t("warranty.bill")}</dt><dd className="font-medium">{w.invoice?.invoiceNumber ?? "—"}</dd></div>
            <div><dt className="text-foreground-muted">{t("warranty.customer")}</dt><dd className="font-medium">{w.invoice?.customerName ?? "—"}{w.invoice?.customerPhone ? ` · ${w.invoice.customerPhone}` : ""}</dd></div>
          </dl>

          {w.status === "SOLD" && (
            <form className="rise card-surface flex flex-wrap gap-3 p-5" style={{ "--i": 2 } as React.CSSProperties} onSubmit={(e) => { e.preventDefault(); if (claim.trim()) logClaim.mutate(); }}>
              <input value={claim} onChange={(e) => setClaim(e.target.value)} placeholder={t("warranty.claimPlaceholder")} aria-label={t("warranty.claimAria")} maxLength={300} className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm" />
              <Button type="submit" variant="secondary" disabled={!claim.trim() || logClaim.isPending}><BadgeCheck className="h-4 w-4" aria-hidden="true" /> {t("warranty.logClaim")}</Button>
            </form>
          )}

          <section className="rise card-surface p-5" style={{ "--i": 3 } as React.CSSProperties}>
            <h2 className="mb-3 text-sm font-semibold">{t("warranty.history")}</h2>
            <ol className="space-y-2 border-l border-border pl-4">
              {w.history.map((h, i) => (
                <li key={i} className="text-sm"><span className="font-medium">{historyLabel(t, h.type)}</span> <span className="text-foreground-muted">· {fmt(h.at)}{h.note ? ` · ${h.note}` : ""}</span></li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
