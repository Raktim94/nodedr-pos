"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { Product } from "@/lib/types";

// Asked at the moment of SALE: scan or type the IMEI / serial number of each
// unit being sold (the scanner types it and presses Enter). Nothing is looked
// up in stock — the server validates the number (IMEI checksum, not already
// sold) when the bill is finalized.
export function SerialPrompt({
  product,
  existing,
  onDone,
  onClose,
}: {
  product: Product;
  existing: string[];
  onDone: (serials: string[]) => void;
  onClose: () => void;
}) {
  const [serials, setSerials] = useState<string[]>(existing);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function add() {
    const code = value.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) return;
    if (code.length < 4 || code.length > 64) return setError("An IMEI / serial number is 4–64 characters");
    if (serials.includes(code)) return setError("Already added to this bill");
    setError("");
    setSerials((s) => [...s, code]);
    setValue("");
  }

  return (
    <Modal title={`IMEI / serial — ${product.name}`} onClose={onClose} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="text-sm font-medium" htmlFor="serial-input">
          IMEI / serial number of the unit sold
        </label>
        <input
          id="serial-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          placeholder="Scan or type, then Enter"
          className="rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <ul className="flex flex-wrap gap-2">
          {serials.map((s) => (
            <li key={s} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 font-mono text-xs text-brand">
              {s}
              <button type="button" aria-label={`Remove ${s}`} onClick={() => setSerials((x) => x.filter((y) => y !== s))}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-foreground-muted">
            {serials.length} unit{serials.length === 1 ? "" : "s"} · {product.warrantyMonths ? `${product.warrantyMonths}-month warranty starts today` : "no warranty"}
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" disabled={!value.trim()}>
              Add
            </Button>
            <Button type="button" disabled={serials.length === 0} onClick={() => onDone(serials)}>
              Done
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
