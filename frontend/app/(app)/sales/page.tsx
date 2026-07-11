"use client";

import { useState } from "react";
import { Search, X, Printer } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useInvoices, useInvoice } from "@/hooks/useInvoices";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";

export default function SalesPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: invoices, isLoading } = useInvoices(search);
  const { data: shop } = useShopSettings();
  const sym = shop?.currencySymbol || "Rs.";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Sales</h1>
        <p className="text-sm text-foreground/60">Past invoices — click one to view or reprint.</p>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Search className="h-4 w-4 text-foreground/40" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by invoice #, customer or phone…"
            aria-label="Search invoices"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
          />
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-foreground/50">Loading…</p>
        ) : !invoices || invoices.length === 0 ? (
          <p className="py-10 text-center text-sm text-foreground/50">No sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-foreground/50">
                  <th className="py-2 pr-4">Invoice #</th>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4">Payment</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => setSelectedId(inv.id)}
                    className="cursor-pointer hover:bg-surface-muted"
                  >
                    <td className="py-2.5 pr-4 font-medium text-brand">{inv.invoiceNumber}</td>
                    <td className="py-2.5 pr-4 text-foreground/70">{new Date(inv.createdAt).toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-foreground/70">{inv.customerName}</td>
                    <td className="py-2.5 pr-4 text-foreground/70">{inv.paymentMethod}</td>
                    <td className="py-2.5 text-right font-medium text-foreground">{formatMoney(inv.totalAmount, sym)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedId != null && <InvoiceDrawer id={selectedId} sym={sym} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function InvoiceDrawer({ id, sym, onClose }: { id: number; sym: string; onClose: () => void }) {
  const { data: invoice, isLoading } = useInvoice(id);
  const { show } = useToast();
  const [printing, setPrinting] = useState(false);
  const money = (n: number) => formatMoney(n, sym);

  async function reprint() {
    setPrinting(true);
    try {
      const res = await api.post<{ printed: boolean; reason?: string }>("/print", { invoiceId: id });
      show(res.printed ? "Sent to printer" : res.reason || "No printer detected", res.printed ? "success" : "info");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Print failed", "error");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invoice details"
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-md overflow-y-auto bg-surface p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{invoice?.invoiceNumber || "Invoice"}</h2>
          <button aria-label="Close" onClick={onClose} className="text-foreground/40 hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {isLoading || !invoice ? (
          <p className="text-sm text-foreground/50">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="text-foreground/60">
              <p>{new Date(invoice.createdAt).toLocaleString()}</p>
              <p>{invoice.customerName}{invoice.customerPhone ? ` · ${invoice.customerPhone}` : ""}</p>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs uppercase text-foreground/50">
                    <th className="p-2">Item</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoice.items.map((it) => (
                    <tr key={it.id}>
                      <td className="p-2 text-foreground">{it.name}</td>
                      <td className="p-2 text-right text-foreground/70">{it.quantity}</td>
                      <td className="p-2 text-right text-foreground/70">{money(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-1">
              <Line label="Subtotal" value={money(invoice.subtotal)} />
              {invoice.discountAmount > 0 && <Line label="Discount" value={`- ${money(invoice.discountAmount)}`} />}
              {invoice.taxAmount > 0 && <Line label="GST" value={money(invoice.taxAmount)} />}
              {invoice.loyaltyDiscount > 0 && (
                <Line label={`Loyalty (${invoice.pointsRedeemed} pts)`} value={`- ${money(invoice.loyaltyDiscount)}`} />
              )}
              <div className="my-1 border-t border-border" />
              <div className="flex justify-between font-semibold text-foreground">
                <span>Total</span>
                <span>{money(invoice.totalAmount)}</span>
              </div>
              <Line label={`Paid (${invoice.paymentMethod})`} value={money(invoice.amountPaid)} />
              {invoice.changeDue > 0 && <Line label="Change" value={money(invoice.changeDue)} />}
              {invoice.pointsEarned > 0 && <Line label="Points earned" value={`${invoice.pointsEarned}`} />}
            </div>

            <Button onClick={reprint} disabled={printing} className="w-full">
              <Printer className="h-4 w-4" aria-hidden="true" />
              {printing ? "Printing…" : "Reprint receipt"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-foreground/60">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
