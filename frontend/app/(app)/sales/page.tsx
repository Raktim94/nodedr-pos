"use client";

import { useMemo, useState } from "react";
import { Search, Undo2, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ReceiptActions } from "@/components/ReceiptActions";
import { ShareActions } from "@/components/pos/ShareActions";
import { useInvoices, useInvoice } from "@/hooks/useInvoices";
import { useCreateReturn, useReturnsForInvoice } from "@/hooks/useReturns";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/components/I18nProvider";
import { paymentMethodKey } from "@/lib/enumLabels";
import type { TranslationKey } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";
import { ApiError } from "@/lib/api";
import type { RefundMethod } from "@/lib/types";

const methodLabel = (t: (key: TranslationKey) => string, method: string) => {
  const key = paymentMethodKey(method);
  return key ? t(key) : method;
};

export default function SalesPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: invoices, isLoading } = useInvoices(search);
  const { data: shop } = useShopSettings();
  const { t } = useTranslation();
  const sym = shop?.currencySymbol || "Rs.";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("sales.title")}</h1>
        <p className="text-sm text-foreground/60">{t("sales.subtitle")}</p>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Search className="h-4 w-4 text-foreground/40" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("sales.searchPlaceholder")}
            aria-label={t("sales.searchAria")}
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
          />
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-foreground/50">{t("sales.loading")}</p>
        ) : !invoices || invoices.length === 0 ? (
          <p className="py-10 text-center text-sm text-foreground/50">{t("sales.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-foreground/50">
                  <th className="py-2 pr-4">{t("sales.colInvoice")}</th>
                  <th className="py-2 pr-4">{t("sales.colDate")}</th>
                  <th className="py-2 pr-4">{t("sales.colCustomer")}</th>
                  <th className="py-2 pr-4">{t("sales.colPayment")}</th>
                  <th className="py-2 text-right">{t("sales.colTotal")}</th>
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
                    <td className="py-2.5 pr-4 text-foreground/70">{methodLabel(t, inv.paymentMethod)}</td>
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
  const { data: returns } = useReturnsForInvoice(id);
  const createReturn = useCreateReturn();
  const { show } = useToast();
  const { t } = useTranslation();
  const money = (n: number) => formatMoney(n, sym);

  const [returnQty, setReturnQty] = useState<Record<number, number>>({});
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("CASH");

  // Quantity already returned per invoice item, summed across every past
  // return — the same unit can't be selected again once it's fully returned.
  const returnedByItem = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of returns ?? []) {
      for (const it of r.items) {
        map.set(it.invoiceItemId, (map.get(it.invoiceItemId) || 0) + it.quantity);
      }
    }
    return map;
  }, [returns]);

  const returnPreview = useMemo(() => {
    if (!invoice) return { count: 0, amount: 0 };
    let count = 0;
    let amount = 0;
    for (const it of invoice.items) {
      const qty = returnQty[it.id] || 0;
      if (qty > 0) {
        count += qty;
        amount += (it.total / it.quantity) * qty;
      }
    }
    return { count, amount: Math.round((amount + Number.EPSILON) * 100) / 100 };
  }, [invoice, returnQty]);

  async function processReturn() {
    if (!invoice || returnPreview.count === 0) return;
    const items = invoice.items
      .filter((it) => (returnQty[it.id] || 0) > 0)
      .map((it) => ({ invoiceItemId: it.id, quantity: returnQty[it.id] }));
    try {
      await createReturn.mutateAsync({ invoiceId: invoice.id, items, refundMethod });
      setReturnQty({});
      show(t("sales.returned", { count: returnPreview.count, amount: money(returnPreview.amount) }), "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : t("sales.returnFailed"), "error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("sales.invoiceDetails")}
        className="h-full w-full max-w-md overflow-y-auto bg-surface p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{invoice?.invoiceNumber || t("sales.invoice")}</h2>
          <button aria-label={t("sales.close")} onClick={onClose} className="text-foreground/40 hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {isLoading || !invoice ? (
          <p className="text-sm text-foreground/50">{t("sales.loading")}</p>
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
                    <th className="p-2">{t("sales.item")}</th>
                    <th className="p-2 text-right">{t("sales.qty")}</th>
                    <th className="p-2 text-right">{t("sales.total")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoice.items.map((it) => (
                    <tr key={it.id}>
                      <td className="p-2 text-foreground">{it.name}</td>
                      <td className="p-2 text-right text-foreground/70">
                      {it.quantity}
                      {it.unit ? ` ${it.unit}` : ""}
                    </td>
                      <td className="p-2 text-right text-foreground/70">{money(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-1">
              <Line label={t("sales.subtotal")} value={money(invoice.subtotal)} />
              {invoice.discountAmount > 0 && <Line label={t("sales.discount")} value={`- ${money(invoice.discountAmount)}`} />}
              {invoice.taxAmount > 0 && <Line label={t("sales.gstIncluded")} value={money(invoice.taxAmount)} />}
              {invoice.loyaltyDiscount > 0 && (
                <Line label={t("sales.loyalty", { points: invoice.pointsRedeemed })} value={`- ${money(invoice.loyaltyDiscount)}`} />
              )}
              <div className="my-1 border-t border-border" />
              <div className="flex justify-between font-semibold text-foreground">
                <span>{t("sales.total")}</span>
                <span>{money(invoice.totalAmount)}</span>
              </div>
              <Line label={t("sales.paid", { method: methodLabel(t, invoice.paymentMethod) })} value={money(invoice.amountPaid)} />
              {invoice.changeDue > 0 && <Line label={t("sales.change")} value={money(invoice.changeDue)} />}
              {invoice.pointsEarned > 0 && <Line label={t("sales.pointsEarned")} value={`${invoice.pointsEarned}`} />}
            </div>

            <ReceiptActions invoiceId={id} />
            <ShareActions invoiceId={id} />

            <div className="rounded-lg border border-border p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                {t("sales.returnItems")}
              </h3>
              <div className="flex flex-col gap-2">
                {invoice.items.map((it) => {
                  const returnable = it.quantity - (returnedByItem.get(it.id) || 0);
                  if (returnable <= 0) {
                    return (
                      <div key={it.id} className="flex items-center justify-between text-xs text-foreground/40">
                        <span>{it.name}</span>
                        <span>{t("sales.fullyReturned")}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={it.id} className="flex items-center justify-between gap-3">
                      <span className="flex-1 truncate text-foreground/80">{it.name}</span>
                      <span className="text-xs text-foreground/40">{t("sales.of", { n: returnable })}</span>
                      <input
                        type="number"
                        min={0}
                        max={returnable}
                        value={returnQty[it.id] || ""}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(returnable, Number(e.target.value) || 0));
                          setReturnQty((prev) => ({ ...prev, [it.id]: v }));
                        }}
                        placeholder="0"
                        aria-label={t("sales.returnQtyAria", { name: it.name })}
                        className="w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm text-foreground"
                      />
                    </div>
                  );
                })}
              </div>

              {returnPreview.count > 0 && (
                <>
                  <div className="mt-3 flex items-center gap-2">
                    <select
                      aria-label={t("sales.refundMethod")}
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value as RefundMethod)}
                      className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    >
                      <option value="CASH">{t("sales.refundCash")}</option>
                      <option value="UPI">{t("sales.refundUpi")}</option>
                      <option value="CARD">{t("sales.refundCard")}</option>
                      <option value="DUE_ADJUST" disabled={!invoice.customerId}>
                        {t("sales.adjustDue")}
                      </option>
                    </select>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-foreground/60">{t("sales.refundTotal")}</span>
                    <span className="font-semibold text-foreground">{money(returnPreview.amount)}</span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2 w-full"
                    onClick={processReturn}
                    disabled={createReturn.isPending}
                  >
                    {createReturn.isPending ? t("sales.processing") : t("sales.processReturn", { count: returnPreview.count })}
                  </Button>
                </>
              )}

              {returns && returns.length > 0 && (
                <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3">
                  <p className="text-xs font-medium uppercase text-foreground/40">{t("sales.pastReturns")}</p>
                  {returns.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-xs text-foreground/60">
                      <span>
                        {new Date(r.createdAt).toLocaleDateString()} · {t("sales.itemsSuffix", { count: r.items.reduce((s, i) => s + i.quantity, 0) })} ·{" "}
                        {methodLabel(t, r.refundMethod)}
                      </span>
                      <span>{money(r.totalRefund)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
