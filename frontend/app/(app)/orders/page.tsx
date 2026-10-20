"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ClipboardList, QrCode, Store, Truck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/Bits";
import { Modal } from "@/components/ui/Modal";
import { api, describeApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/components/I18nProvider";
import { orderStatusKey, paymentMethodKey } from "@/lib/enumLabels";
import type { TranslationKey } from "@/lib/i18n";
import type { Order } from "@/lib/types";

type Col = "NEW" | "PACKING" | "READY" | "COLLECTED";
const COLUMNS: { key: Col; title: TranslationKey; hint: TranslationKey }[] = [
  { key: "NEW", title: "orders.colNew", hint: "orders.hintNew" },
  { key: "PACKING", title: "orders.colPacking", hint: "orders.hintPacking" },
  { key: "READY", title: "orders.colReady", hint: "orders.hintReady" },
  { key: "COLLECTED", title: "orders.colCollected", hint: "orders.hintCollected" },
];
const NEXT: Record<string, Col | undefined> = { NEW: "PACKING", PACKING: "READY", READY: "COLLECTED" };
const ALLOWED: Record<string, string[]> = { NEW: ["PACKING", "READY"], PACKING: ["READY"], READY: ["COLLECTED"] };

type T = (key: TranslationKey) => string;

const channelLabel = (t: T, c: string) => ({ API: t("orders.channelApi"), WOOCOMMERCE: "WooCommerce", SHOPIFY: "Shopify", GENERIC: "Webhook" }[c] ?? c);
const statusLabel = (t: T, status: string) => {
  const key = orderStatusKey(status);
  return key ? t(key) : status.toLowerCase();
};
const methodLabel = (t: T, method: string) => {
  const key = paymentMethodKey(method);
  return key ? t(key) : method;
};

export default function OrdersPage() {
  const { data: shop } = useShopSettings();
  const sym = shop?.currencySymbol ?? "Rs.";
  const { show } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<Col | null>(null);
  const [collecting, setCollecting] = useState<Order | null>(null);
  const [code, setCode] = useState("");
  const [announce, setAnnounce] = useState("");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.get<Order[]>("/orders?status=NEW,PACKING,READY,COLLECTED&limit=200"),
    refetchInterval: 15_000,
  });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patch<Order>(`/orders/${id}/status`, { status }),
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      setAnnounce(t("orders.moved", { code: o.pickupCode, status: statusLabel(t, o.status) }));
    },
    onError: (e) => show(describeApiError(e, t("orders.moveFailed")), "error"),
  });

  const byCol = useMemo(() => {
    const m: Record<Col, Order[]> = { NEW: [], PACKING: [], READY: [], COLLECTED: [] };
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    for (const o of orders) {
      if (o.status === "COLLECTED") {
        if (new Date(o.createdAt).getTime() >= startOfDay) m.COLLECTED.push(o);
      } else if (o.status in m) m[o.status as Col].push(o);
    }
    return m;
  }, [orders]);

  const drop = useCallback(
    (col: Col) => {
      const o = orders.find((x) => x.id === drag);
      setDrag(null);
      setOver(null);
      if (!o || o.status === col) return;
      if (col === "COLLECTED") return setCollecting(o);
      if (!ALLOWED[o.status]?.includes(col)) return show(t("orders.invalidMove", { from: statusLabel(t, o.status), to: statusLabel(t, col) }), "error");
      move.mutate({ id: o.id, status: col });
    },
    [drag, orders, move, show, t]
  );

  async function findByCode() {
    try {
      const o = await api.get<Order>(`/orders/by-code/${encodeURIComponent(code.trim())}`);
      setCollecting(o);
      setCode("");
    } catch (e) {
      show(describeApiError(e, t("orders.noOrderWithCode")), "error");
    }
  }

  return (
    <div>
      <PageHeader
        title={t("orders.title")}
        subtitle={t("orders.subtitle")}
        actions={
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) findByCode(); }}>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t("orders.pickupCode")} aria-label={t("orders.pickupCode")} maxLength={8} className="w-32 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm uppercase tracking-widest" />
            <Button type="submit" variant="secondary" disabled={!code.trim()}>
              <QrCode className="h-4 w-4" aria-hidden="true" /> {t("orders.collect")}
            </Button>
          </form>
        }
      />
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {isLoading ? (
        <p className="text-foreground-muted">{t("orders.loading")}</p>
      ) : (
        <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 xl:grid xl:grid-cols-4 xl:overflow-visible">
          {COLUMNS.map((col, ci) => (
            <section
              key={col.key}
              aria-label={t("orders.columnAria", { title: t(col.title) })}
              onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={() => drop(col.key)}
              className={`rise min-w-[270px] snap-start rounded-2xl border p-3 transition-colors xl:min-w-0 ${over === col.key ? "border-brand bg-brand-soft" : "border-border bg-surface-muted/60"}`}
              style={{ "--i": ci } as React.CSSProperties}
            >
              <header className="mb-3 flex items-center justify-between px-1">
                <div>
                  <h2 className="text-sm font-semibold">{t(col.title)}</h2>
                  <p className="text-xs text-foreground-muted">{t(col.hint)}</p>
                </div>
                <Badge tone={col.key === "READY" ? "good" : "neutral"}>{byCol[col.key].length}</Badge>
              </header>
              <ul className="flex flex-col gap-2.5">
                {byCol[col.key].length === 0 && <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-foreground-muted">{t("orders.nothingHere")}</li>}
                {byCol[col.key].map((o) => (
                  <li
                    key={o.id}
                    draggable={o.status !== "COLLECTED"}
                    onDragStart={() => setDrag(o.id)}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    className={`card-surface p-3 transition-[opacity,transform] duration-200 ${drag === o.id ? "opacity-50" : ""} ${o.status !== "COLLECTED" ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{o.customerName}</p>
                        <p className="font-mono text-xs tracking-widest text-foreground-muted">{o.pickupCode}{o.externalId ? <span className="ml-2 tracking-normal">#{o.externalId}</span> : null}</p>
                      </div>
                      <p className="tabular text-sm font-semibold">{formatMoney(o.total, sym)}</p>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs text-foreground-muted">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone="brand">
                        {o.fulfilment === "DELIVERY" ? <Truck className="h-3 w-3" aria-hidden="true" /> : <Store className="h-3 w-3" aria-hidden="true" />}
                        {channelLabel(t, o.channel)} · {o.fulfilment === "DELIVERY" ? t("orders.delivery") : t("orders.pickup")}
                      </Badge>
                      {o.paid && <Badge tone="good">{t("orders.paid")}</Badge>}
                    </div>
                    {o.status !== "COLLECTED" && (
                      <div className="mt-2.5 flex gap-2">
                        <Button
                          variant="secondary"
                          className="flex-1 !px-3 !py-1.5 text-xs"
                          onClick={() => (NEXT[o.status] === "COLLECTED" ? setCollecting(o) : move.mutate({ id: o.id, status: NEXT[o.status]! }))}
                        >
                          {NEXT[o.status] === "COLLECTED" ? <><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {o.paid ? t("orders.handOver") : t("orders.handOverBill")}</> : <>{t("orders.moveTo", { status: NEXT[o.status] ? statusLabel(t, NEXT[o.status]!) : "" })} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></>}
                        </Button>
                        <Button variant="ghost" aria-label={t("orders.cancelAria", { code: o.pickupCode })} className="!px-2.5 !py-1.5" onClick={() => move.mutate({ id: o.id, status: "CANCELLED" })}>
                          <XCircle className="h-4 w-4 text-danger" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {!isLoading && orders.length === 0 && <EmptyState icon={<ClipboardList className="h-8 w-8" />} title={t("orders.emptyTitle")} hint={t("orders.emptyHint")} />}

      {collecting && <CollectDialog order={collecting} sym={sym} onClose={() => setCollecting(null)} onDone={() => { setCollecting(null); qc.invalidateQueries({ queryKey: ["orders"] }); qc.invalidateQueries({ queryKey: ["products"] }); }} />}
    </div>
  );
}

function CollectDialog({ order, sym, onClose, onDone }: { order: Order; sym: string; onClose: () => void; onDone: () => void }) {
  const { show } = useToast();
  const { t } = useTranslation();
  // Paid on the website -> the website already issued the invoice, so default
  // to no POS bill. Pay-at-pickup -> bill here. The cashier can flip either.
  const [bill, setBill] = useState(!order.paid);
  const [method, setMethod] = useState<"CASH" | "UPI" | "CARD">(order.paid ? "UPI" : "CASH");
  const [received, setReceived] = useState(String(order.total));
  const [serials, setSerials] = useState<Record<number, string>>({});
  const { data: products } = useQuery({ queryKey: ["products", ""], queryFn: () => api.get<{ id: number; trackSerial: boolean }[]>("/products") });
  const { data: shop } = useShopSettings();
  const tracked = new Set(shop?.serialTracking ? (products ?? []).filter((p) => p.trackSerial).map((p) => p.id) : []);

  const run = useMutation({
    mutationFn: () =>
      api.post(`/orders/${order.id}/collect`, {
        bill,
        paymentMethod: method,
        amountPaid: bill && method === "CASH" ? Number(received) || 0 : 0,
        serials: bill ? Object.fromEntries(Object.entries(serials).map(([k, v]) => [k, v.split(/[\s,;]+/).filter(Boolean)])) : {},
      }),
    onSuccess: () => { show(bill ? t("orders.billedToast", { code: order.pickupCode }) : t("orders.handedOverToast", { code: order.pickupCode }), "success"); onDone(); },
    onError: (e) => show(describeApiError(e, t("orders.handOverFailed")), "error"),
  });

  return (
    <Modal title={t("orders.handOverTitle", { name: order.customerName })} onClose={onClose} size="sm">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-sm tracking-widest text-foreground-muted">
          {order.pickupCode}{order.externalId ? ` · ${t("orders.storeOrder", { id: order.externalId })}` : ""}
        </p>
        <ul className="text-sm">
          {order.items.map((i) => (
            <li key={i.productId} className="flex justify-between py-0.5"><span>{i.quantity}× {i.name}</span><span className="tabular">{formatMoney(i.price * i.quantity, sym)}</span></li>
          ))}
        </ul>
        <p className={`rounded-lg px-3 py-2 text-sm ${order.paid ? "bg-success-soft text-success" : "bg-surface-muted text-foreground-muted"}`}>
          {order.paid ? t("orders.paidOnWebsite") : t("orders.notPaidYet")}
        </p>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={bill} onChange={(e) => setBill(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
          <span>
            <span className="font-medium">{t("orders.billInPos")}</span>
            <span className="block text-xs text-foreground-muted">{bill ? t("orders.billMade") : t("orders.noBillMade")}</span>
          </span>
        </label>
        {bill && order.items.filter((i) => tracked.has(i.productId)).map((i) => (
          <label key={i.productId} className="flex flex-col gap-1 text-sm font-medium">
            {t("orders.imeiFor", { name: i.name, count: i.quantity })}
            <textarea value={serials[i.productId] ?? ""} onChange={(e) => setSerials((s) => ({ ...s, [i.productId]: e.target.value }))} rows={2} placeholder={t("orders.scanEachUnit")} className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" />
          </label>
        ))}
        {bill && !order.paid && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "UPI", "CARD"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)} className={`rounded-lg border px-3 py-2 text-sm font-medium ${method === m ? "border-brand bg-brand text-brand-foreground" : "border-border"}`}>{methodLabel(t, m)}</button>
              ))}
            </div>
            {method === "CASH" && (
              <label className="flex flex-col gap-1 text-sm font-medium">{t("orders.cashReceived")}
                <input type="number" min={0} step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2" />
              </label>
            )}
          </>
        )}
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? t("orders.saving") : bill ? t("orders.billAndHandOver", { amount: formatMoney(order.total, sym) }) : t("orders.handOverStock")}
        </Button>
      </div>
    </Modal>
  );
}
