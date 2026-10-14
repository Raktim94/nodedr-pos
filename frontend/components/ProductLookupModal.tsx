"use client";

import { useState } from "react";
import { CheckCircle2, Globe, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useTranslation } from "@/components/I18nProvider";
import { api, describeApiError } from "@/lib/api";
import type { ProductLookupResponse, ProductLookupResult } from "@/lib/types";

// Search free online product databases (Open Food/Beauty/Products Facts) by
// name or barcode. Picking a result hands it to the product form for review —
// nothing is saved here.
export function ProductLookupModal({ onPick, onClose }: { onPick: (r: ProductLookupResult) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<ProductLookupResponse | null>(null);
  const [error, setError] = useState("");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (text.length < 2) return;
    setState("loading");
    try {
      setData(await api.get<ProductLookupResponse>(`/products/lookup?q=${encodeURIComponent(text)}`));
      setState("done");
    } catch (err) {
      setError(describeApiError(err, t("productLookup.failed")));
      setState("error");
    }
  }

  return (
    <Modal title={t("productLookup.title")} onClose={onClose} size="lg">
      <form onSubmit={search} className="flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Search className="h-4 w-4 text-foreground/40" aria-hidden="true" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("productLookup.placeholder")}
            aria-label={t("productLookup.searchAria")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-foreground/40"
          />
        </div>
        <Button type="submit" disabled={q.trim().length < 2 || state === "loading"}>{state === "loading" ? t("productLookup.searching") : t("productLookup.search")}</Button>
      </form>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-muted">
        <Globe className="h-3.5 w-3.5" aria-hidden="true" /> {t("productLookup.hint")}
      </p>

      <div className="mt-4" aria-live="polite">
        {state === "error" && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
            <p className="font-medium text-danger">{error}</p>
            <p className="mt-1 text-foreground-muted">{t("productLookup.manualHint")}</p>
          </div>
        )}
        {state === "done" && data && (
          <>
            {data.warnings.map((w) => (<p key={w} className="mb-2 rounded-lg bg-surface-muted p-2.5 text-xs text-foreground-muted">{w}</p>))}
            {data.results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm">
                <p className="font-medium">{t("productLookup.none", { query: q.trim() })}</p>
                <p className="mt-1 text-foreground-muted">{t("productLookup.noneHint")}</p>
              </div>
            ) : (
              <ul className="flex max-h-[50vh] flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {data.results.map((r) => (
                  <li key={r.barcode} className="flex items-center gap-3 p-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-muted">
                      {r.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="truncate text-xs text-foreground-muted">{[r.brand, r.quantity, r.category].filter(Boolean).join(" · ") || t("productLookup.noDetails")}</p>
                      <p className="font-mono text-xs text-foreground-muted">{r.barcode} · {r.source}</p>
                      {r.warnings.length > 0 && <p className="mt-0.5 text-xs text-warning">⚠ {r.warnings.join(" · ")}</p>}
                    </div>
                    {r.inCatalog ? (
                      <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {t("productLookup.inCatalog")}</span>
                    ) : (
                      <Button variant="secondary" onClick={() => onPick(r)}>{t("productLookup.reviewAdd")}</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
