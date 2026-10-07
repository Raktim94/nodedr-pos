"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { describeApiError } from "@/lib/api";
import { lookupBarcode } from "@/lib/productLookup";
import type { ProductLookupResult } from "@/lib/types";

interface Current { name: string; category: string; imageSrc: string | null }

// "Check online" for the product form: looks the barcode up, shows the online
// data next to what the form has now, and lets the user replace each field
// separately (name, category, photo). Nothing is saved until the form is.
export function OnlineMatchPanel({
  barcode, current, onUseName, onUseCategory, onUseImage,
}: {
  barcode: string;
  current: Current;
  onUseName: (v: string) => void;
  onUseCategory: (v: string) => void;
  onUseImage: (url: string) => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "found" | "none" | "error">("idle");
  const [match, setMatch] = useState<ProductLookupResult | null>(null);
  const [error, setError] = useState("");

  async function check() {
    setState("loading");
    try {
      const m = await lookupBarcode(barcode);
      setMatch(m);
      setState(m ? "found" : "none");
    } catch (e) {
      setError(describeApiError(e, "Online lookup failed"));
      setState("error");
    }
  }

  const row = "grid grid-cols-[5rem_1fr_auto] items-center gap-2 py-2 text-sm";
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={!barcode.trim() || state === "loading"} onClick={check}>
          <Globe className="h-4 w-4" aria-hidden="true" /> {state === "loading" ? "Checking…" : "Check online"}
        </Button>
        <span className="text-xs text-foreground-muted">Compare this barcode with Open Food Facts and replace name, category or photo.</span>
      </div>
      <div aria-live="polite">
        {state === "none" && <p className="mt-2 text-sm text-foreground-muted">No online record for {barcode}. Keep your own details.</p>}
        {state === "error" && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        {state === "found" && match && (
          <div className="mt-2 divide-y divide-border">
            {match.warnings.length > 0 && <p className="pb-2 text-xs text-warning">⚠ {match.warnings.join(" · ")}</p>}
            <div className={row}>
              <span className="text-xs font-medium text-foreground-muted">Name</span>
              <span className="min-w-0"><span className="block truncate">{match.name}</span>{current.name && current.name !== match.name && <span className="block truncate text-xs text-foreground-muted">now: {current.name}</span>}</span>
              {current.name === match.name ? <span className="text-xs text-success">Same</span> : <Button type="button" variant="ghost" onClick={() => onUseName(match.name)}>Use</Button>}
            </div>
            <div className={row}>
              <span className="text-xs font-medium text-foreground-muted">Category</span>
              <span className="min-w-0"><span className="block truncate">{match.category ?? "—"}</span>{current.category && current.category !== match.category && <span className="block truncate text-xs text-foreground-muted">now: {current.category}</span>}</span>
              {!match.category ? null : current.category === match.category ? <span className="text-xs text-success">Same</span> : <Button type="button" variant="ghost" onClick={() => onUseCategory(match.category!)}>Use</Button>}
            </div>
            <div className={row}>
              <span className="text-xs font-medium text-foreground-muted">Photo</span>
              <span className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {match.imageUrl ? <img src={match.imageUrl} alt="Online photo" referrerPolicy="no-referrer" className="h-12 w-12 rounded-md border border-border object-cover" /> : <span className="text-foreground-muted">—</span>}
                {current.imageSrc && match.imageUrl && <span className="text-xs text-foreground-muted">replaces the current photo</span>}
              </span>
              {match.imageUrl ? <Button type="button" variant="ghost" onClick={() => onUseImage(match.imageUrl!)}>Use photo</Button> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
