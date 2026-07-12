"use client";

import { useState } from "react";
import { Search, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/lib/api";
import { formatMoney, round2 } from "@/lib/format";
import type { Invoice, ReturnRecord } from "@/lib/types";

// A single line the cashier has queued to return, flattened across invoices.
export interface ReturnDraftLine {
  invoiceId: number;
  invoiceNumber: string;
  invoiceItemId: number;
  productId: number;
  name: string;
  quantity: number;
  maxQuantity: number;
  unitPaid: number;
  refundAmount: number;
}

type Row = { invoiceItemId: number; productId: number; name: string; returnable: number; unitPaid: number; qty: number; refund: string };

interface Props {
  sym: string;
  drafted: ReturnDraftLine[];
  onAdd: (lines: ReturnDraftLine[]) => void;
  /** Called once a bill is found, so the checkout page can attach the same
   * customer without a separate phone lookup — needed for the "Store
   * credit" refund option and "Use store credit" to become available. */
  onInvoiceFound?: (info: { customerPhone: string | null; customerName: string }) => void;
}

export function ReturnPanel({ sym, drafted, onAdd, onInvoiceFound }: Props) {
  const { show } = useToast();
  const money = (n: number) => formatMoney(n, sym);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  async function lookup() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    try {
      const matches = await api.get<Invoice[]>(`/invoices?q=${encodeURIComponent(q)}`);
      const inv =
        matches.find((m) => m.invoiceNumber.toLowerCase() === q.toLowerCase()) || (matches.length === 1 ? matches[0] : null);
      if (!inv) {
        show(matches.length > 1 ? "Multiple bills match — type the full invoice number" : "No bill found", "error");
        setInvoice(null);
        setRows([]);
        return;
      }
      const [full, past] = await Promise.all([
        api.get<Invoice>(`/invoices/${inv.id}`),
        api.get<ReturnRecord[]>(`/returns/by-invoice/${inv.id}`),
      ]);
      const returnedByItem = new Map<number, number>();
      for (const r of past) for (const it of r.items) returnedByItem.set(it.invoiceItemId, (returnedByItem.get(it.invoiceItemId) || 0) + it.quantity);
      // Also subtract anything already queued in this checkout for the same line.
      for (const d of drafted) if (d.invoiceId === inv.id) returnedByItem.set(d.invoiceItemId, (returnedByItem.get(d.invoiceItemId) || 0) + d.quantity);

      const next: Row[] = full.items
        .map((it) => {
          const returnable = it.quantity - (returnedByItem.get(it.id) || 0);
          return { invoiceItemId: it.id, productId: it.productId, name: it.name, returnable, unitPaid: it.total / it.quantity, qty: 0, refund: "" };
        })
        .filter((r) => r.returnable > 0);
      if (next.length === 0) show("Everything on this bill has already been returned", "info");
      setInvoice(full);
      setRows(next);
      onInvoiceFound?.({ customerPhone: full.customerPhone, customerName: full.customerName });
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Lookup failed", "error");
    } finally {
      setLoading(false);
    }
  }

  function setQty(id: number, qty: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.invoiceItemId !== id) return r;
        const q = Math.max(0, Math.min(qty, r.returnable));
        // Keep the refund in step with the quantity unless the cashier typed one.
        return { ...r, qty: q, refund: q === 0 ? "" : String(round2(r.unitPaid * q)) };
      })
    );
  }

  function addToReturn() {
    if (!invoice) return;
    const lines: ReturnDraftLine[] = rows
      .filter((r) => r.qty > 0)
      .map((r) => ({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceItemId: r.invoiceItemId,
        productId: r.productId,
        name: r.name,
        quantity: r.qty,
        maxQuantity: r.returnable,
        unitPaid: r.unitPaid,
        refundAmount: round2(Math.min(Number(r.refund) || 0, r.unitPaid * r.qty)),
      }));
    if (lines.length === 0) {
      show("Set a quantity to return first", "error");
      return;
    }
    onAdd(lines);
    setInvoice(null);
    setRows([]);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            label="Return from bill #"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="INV-2026-00001"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                lookup();
              }
            }}
          />
        </div>
        <Button type="button" variant="secondary" onClick={lookup} disabled={loading} aria-label="Find bill">
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {invoice && rows.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-medium text-foreground/60">{invoice.invoiceNumber} — set quantity and refund</p>
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div key={r.invoiceItemId} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-foreground/80" title={r.name}>
                  {r.name}
                </span>
                <span className="whitespace-nowrap text-xs text-foreground/40">of {r.returnable}</span>
                <input
                  type="number"
                  min={0}
                  max={r.returnable}
                  value={r.qty || ""}
                  onChange={(e) => setQty(r.invoiceItemId, Number(e.target.value) || 0)}
                  aria-label={`Return quantity for ${r.name}`}
                  placeholder="0"
                  className="w-14 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm text-foreground"
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={r.qty === 0}
                  value={r.refund}
                  onChange={(e) => setRows((prev) => prev.map((x) => (x.invoiceItemId === r.invoiceItemId ? { ...x, refund: e.target.value } : x)))}
                  aria-label={`Refund amount for ${r.name}`}
                  placeholder={money(0)}
                  title="Refund amount (editable)"
                  className="w-20 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm text-foreground disabled:opacity-50"
                />
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" className="mt-3 w-full" onClick={addToReturn}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Add to return
          </Button>
        </div>
      )}
    </div>
  );
}
