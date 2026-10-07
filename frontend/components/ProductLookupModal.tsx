"use client";

import { useState } from "react";
import { CheckCircle2, Globe, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api, describeApiError } from "@/lib/api";
import type { ProductLookupResponse, ProductLookupResult } from "@/lib/types";

// Search free online product databases (Open Food/Beauty/Products Facts) by
// name or barcode. Picking a result hands it to the product form for review —
// nothing is saved here.
export function ProductLookupModal({ onPick, onClose }: { onPick: (r: ProductLookupResult) => void; onClose: () => void }) {
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
      setError(describeApiError(err, "Product lookup failed"));
      setState("error");
    }
  }

  return (
    <Modal title="Find product online" onClose={onClose} size="lg">
      <form onSubmit={search} className="flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Search className="h-4 w-4 text-foreground/40" aria-hidden="true" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Product name or barcode (e.g. 8901058852523)"
            aria-label="Product name or barcode"
            className="w-full bg-transparent text-sm outline-none placeholder:text-foreground/40"
          />
        </div>
        <Button type="submit" disabled={q.trim().length < 2 || state === "loading"}>{state === "loading" ? "Searching…" : "Search"}</Button>
      </form>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-muted">
        <Globe className="h-3.5 w-3.5" aria-hidden="true" /> Free community data (Open Food Facts and sister sites). Review every detail before adding; prices are not included.
      </p>

      <div className="mt-4" aria-live="polite">
        {state === "error" && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
            <p className="font-medium text-danger">{error}</p>
            <p className="mt-1 text-foreground-muted">You can still add the product by hand.</p>
          </div>
        )}
        {state === "done" && data && (
          <>
            {data.warnings.map((w) => (<p key={w} className="mb-2 rounded-lg bg-surface-muted p-2.5 text-xs text-foreground-muted">{w}</p>))}
            {data.results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm">
                <p className="font-medium">No products found for &ldquo;{q.trim()}&rdquo;.</p>
                <p className="mt-1 text-foreground-muted">Try a shorter name or check the barcode digits. Many local products aren&apos;t listed — add it by hand.</p>
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
                      <p className="truncate text-xs text-foreground-muted">{[r.brand, r.quantity, r.category].filter(Boolean).join(" · ") || "No more details"}</p>
                      <p className="font-mono text-xs text-foreground-muted">{r.barcode} · {r.source}</p>
                    </div>
                    {r.inCatalog ? (
                      <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> In catalog</span>
                    ) : (
                      <Button variant="secondary" onClick={() => onPick(r)}>Review &amp; add</Button>
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
