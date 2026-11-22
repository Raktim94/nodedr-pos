"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, PackageCheck, Pencil, Plus, Send, Trash2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Badge, EmptyState, PageHeader } from "@/components/ui/Bits";
import { Modal } from "@/components/ui/Modal";
import { api, describeApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { Select } from "@/components/ui/Select";
import { useProducts } from "@/hooks/useProducts";
import { useTranslation } from "@/components/I18nProvider";
import { purchaseOrderStatusKey } from "@/lib/enumLabels";
import type { TranslationKey } from "@/lib/i18n";
import type { Supplier } from "@/lib/types";

interface ReorderGroup { supplierId: number | null; supplierName: string; items: { productId: number; name: string; stock: number; reorderPoint: number; unit: string | null; unitCost: number; suggestedQty: number }[] }
interface PO { id: number; number: string; status: "DRAFT" | "SENT" | "RECEIVED" | "CANCELLED"; totalCost: number; createdAt: string; supplier: { name: string }; _count: { items: number } }
interface PODetail extends PO { items: { id: number; productId: number; name: string; quantity: number; unitCost: number; receivedQty: number }[] }

const tone = { DRAFT: "neutral", SENT: "brand", RECEIVED: "good", CANCELLED: "bad" } as const;

const statusLabel = (t: (key: TranslationKey) => string, status: string) => {
  const key = purchaseOrderStatusKey(status);
  return key ? t(key) : status.toLowerCase();
};

export default function PurchasingPage() {
  const { data: shop } = useShopSettings();
  const sym = shop?.currencySymbol ?? "Rs.";
  const { show } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"reorder" | "orders" | "suppliers">("reorder");
  const [receiving, setReceiving] = useState<number | null>(null);
  const [supplierDialog, setSupplierDialog] = useState<Supplier | "new" | null>(null);
  const [poDialog, setPoDialog] = useState(false);

  const { data: reorder = [] } = useQuery({ queryKey: ["reorder"], queryFn: () => api.get<ReorderGroup[]>("/purchasing/reorder") });
  const { data: orders = [] } = useQuery({ queryKey: ["pos"], queryFn: () => api.get<PO[]>("/purchasing/orders") });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get<Supplier[]>("/purchasing/suppliers") });

  const createPo = useMutation({
    mutationFn: (g: ReorderGroup) => api.post<PO>("/purchasing/orders", { supplierId: g.supplierId, items: g.items.map((i) => ({ productId: i.productId, quantity: i.suggestedQty, unitCost: i.unitCost })) }),
    onSuccess: (po) => { show(t("purchasing.poCreated", { number: po.number }), "success"); qc.invalidateQueries({ queryKey: ["pos"] }); setTab("orders"); },
    onError: (e) => show(describeApiError(e, t("purchasing.createFailed")), "error"),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patch(`/purchasing/orders/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
    onError: (e) => show(describeApiError(e, t("purchasing.failed")), "error"),
  });

  return (
    <div>
      <PageHeader title={t("purchasing.title")} subtitle={t("purchasing.subtitle")} actions={<div className="flex gap-2"><Button variant="secondary" onClick={() => setSupplierDialog("new")}><Plus className="h-4 w-4" aria-hidden="true" /> {t("purchasing.supplier")}</Button><Button onClick={() => setPoDialog(true)} disabled={suppliers.length === 0} title={suppliers.length === 0 ? t("purchasing.addSupplierFirst") : undefined}><Plus className="h-4 w-4" aria-hidden="true" /> {t("purchasing.newPurchaseOrder")}</Button></div>} />
      <div role="tablist" aria-label={t("purchasing.title")} className="mb-4 inline-flex rounded-xl border border-border bg-surface p-1">
        {([["reorder", t("purchasing.tabReorder", { count: reorder.reduce((n, g) => n + g.items.length, 0) })], ["orders", t("purchasing.tabOrders")], ["suppliers", t("purchasing.tabSuppliers")]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === k ? "bg-brand text-brand-foreground" : "text-foreground-muted hover:text-foreground"}`}>{label}</button>
        ))}
      </div>

      {tab === "reorder" && (
        <div className="space-y-4">
          {reorder.length === 0 && <EmptyState icon={<PackageCheck className="h-8 w-8" />} title={t("purchasing.nothingToReorder")} hint={t("purchasing.nothingToReorderHint")} />}
          {reorder.map((g) => (
            <section key={g.supplierName} className="rise card-surface p-5">
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4 text-foreground-muted" aria-hidden="true" />{g.supplierName}</h2>
                <Button disabled={!g.supplierId || createPo.isPending} title={g.supplierId ? undefined : t("purchasing.assignSupplierFirst")} onClick={() => createPo.mutate(g)}>{t("purchasing.createPurchaseOrder")}</Button>
              </header>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-foreground-muted"><tr><th className="py-1.5">{t("purchasing.colProduct")}</th><th className="py-1.5 text-right">{t("purchasing.colStock")}</th><th className="py-1.5 text-right">{t("purchasing.colReorderAt")}</th><th className="py-1.5 text-right">{t("purchasing.colSuggest")}</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {g.items.map((i) => (<tr key={i.productId}><td className="py-2 font-medium">{i.name}</td><td className="tabular py-2 text-right text-danger">{i.stock}</td><td className="tabular py-2 text-right">{i.reorderPoint}</td><td className="tabular py-2 text-right font-semibold">{i.suggestedQty}{i.unit ? ` ${i.unit}` : ""}</td></tr>))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {tab === "orders" && (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-foreground-muted"><tr><th className="p-3">{t("purchasing.colOrder")}</th><th className="p-3">{t("purchasing.colSupplier")}</th><th className="p-3">{t("purchasing.colStatus")}</th><th className="p-3 text-right">{t("purchasing.colTotal")}</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="p-3 font-medium">{o.number}<div className="text-xs font-normal text-foreground-muted">{new Date(o.createdAt).toLocaleDateString()} · {t("purchasing.itemsCount", { count: o._count.items })}</div></td>
                  <td className="p-3">{o.supplier.name}</td>
                  <td className="p-3"><Badge tone={tone[o.status]}>{statusLabel(t, o.status)}</Badge></td>
                  <td className="tabular p-3 text-right">{formatMoney(o.totalCost, sym)}</td>
                  <td className="p-3"><div className="flex justify-end gap-1.5">
                    <a href={`/api/purchasing/orders/${o.id}/pdf`} download><Button variant="ghost" aria-label={t("purchasing.downloadPdf", { number: o.number })}><FileDown className="h-4 w-4" aria-hidden="true" /></Button></a>
                    {o.status === "DRAFT" && <Button variant="secondary" onClick={() => setStatus.mutate({ id: o.id, status: "SENT" })}><Send className="h-4 w-4" aria-hidden="true" /> {t("purchasing.markSent")}</Button>}
                    {(o.status === "DRAFT" || o.status === "SENT") && <Button variant="ghost" aria-label={t("purchasing.cancelAria", { number: o.number })} title={t("purchasing.cancelOrder")} onClick={() => { if (window.confirm(t("purchasing.confirmCancel", { number: o.number }))) setStatus.mutate({ id: o.id, status: "CANCELLED" }); }}><X className="h-4 w-4" aria-hidden="true" /></Button>}
                    {(o.status === "DRAFT" || o.status === "SENT") && <Button onClick={() => setReceiving(o.id)}><PackageCheck className="h-4 w-4" aria-hidden="true" /> {t("purchasing.receive")}</Button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <EmptyState title={t("purchasing.noPosYet")} />}
        </div>
      )}

      {tab === "suppliers" && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s, i) => (
            <li key={s.id} className="rise card-surface p-4" style={{ "--i": i } as React.CSSProperties}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{s.name}</p>
                <button type="button" aria-label={t("purchasing.editSupplierAria", { name: s.name })} title={t("purchasing.editSupplier")} onClick={() => setSupplierDialog(s)} className="text-foreground/40 hover:text-brand"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
              </div>
              <p className="text-sm text-foreground-muted">{[s.phone, s.email].filter(Boolean).join(" · ") || t("purchasing.noContact")}</p>
              {s.gstin && <p className="mt-1 font-mono text-xs text-foreground-muted">{t("purchasing.gstin")} {s.gstin}</p>}
            </li>
          ))}
          {suppliers.length === 0 && <EmptyState title={t("purchasing.noSuppliersYet")} hint={t("purchasing.noSuppliersHint")} />}
        </ul>
      )}

      {supplierDialog && <SupplierDialog supplier={supplierDialog === "new" ? undefined : supplierDialog} onClose={() => setSupplierDialog(null)} />}
      {poDialog && <NewPoDialog suppliers={suppliers} onCreated={() => setTab("orders")} onClose={() => setPoDialog(false)} />}
      {receiving != null && <ReceiveDialog id={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const { t } = useTranslation();
  const [f, setF] = useState({ name: supplier?.name ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", address: supplier?.address ?? "", gstin: supplier?.gstin ?? "", notes: supplier?.notes ?? "" });
  const done = () => { qc.invalidateQueries({ queryKey: ["suppliers"] }); qc.invalidateQueries({ queryKey: ["reorder"] }); qc.invalidateQueries({ queryKey: ["products"] }); onClose(); };
  const save = useMutation({
    mutationFn: () => (supplier ? api.put(`/purchasing/suppliers/${supplier.id}`, f) : api.post("/purchasing/suppliers", f)),
    onSuccess: () => { show(supplier ? t("purchasing.supplierUpdated") : t("purchasing.supplierAdded"), "success"); done(); },
    onError: (e) => show(describeApiError(e, t("purchasing.saveFailed")), "error"),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/purchasing/suppliers/${supplier!.id}`),
    onSuccess: () => { show(t("purchasing.supplierDeleted"), "success"); done(); },
    onError: (e) => show(describeApiError(e, t("purchasing.deleteFailed")), "error"),
  });
  return (
    <Modal title={supplier ? t("purchasing.editSupplier") : t("purchasing.addSupplierTitle")} onClose={onClose} size="sm">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label={t("purchasing.name")} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Field label={t("purchasing.phone")} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Field label={t("purchasing.email")} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Field label={t("purchasing.address")} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        <Field label={t("purchasing.gstin")} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
        <Field label={t("purchasing.notes")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <Button type="submit" disabled={save.isPending || !f.name.trim()}>{supplier ? t("purchasing.saveChanges") : t("purchasing.saveSupplier")}</Button>
        {supplier && (
          <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm(t("purchasing.confirmDeleteSupplier", { name: supplier.name }))) remove.mutate(); }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> {t("purchasing.deleteSupplier")}
          </Button>
        )}
      </form>
    </Modal>
  );
}

interface PoLine { productId: number; name: string; quantity: string; unitCost: string }

// Manual purchase order: pick a supplier, add products, set quantity and cost.
function NewPoDialog({ suppliers, onCreated, onClose }: { suppliers: Supplier[]; onCreated: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const { t } = useTranslation();
  const { data: shop } = useShopSettings();
  const sym = shop?.currencySymbol ?? "Rs.";
  const [supplierId, setSupplierId] = useState(String(suppliers[0]?.id ?? ""));
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<PoLine[]>([]);
  const { data: products = [] } = useProducts(search);

  const total = lines.reduce((n, l) => n + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const valid = supplierId !== "" && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0 && Number(l.unitCost) >= 0 && l.unitCost !== "");
  const update = (id: number, patch: Partial<PoLine>) => setLines((ls) => ls.map((l) => (l.productId === id ? { ...l, ...patch } : l)));

  const create = useMutation({
    mutationFn: () => api.post<PO>("/purchasing/orders", { supplierId: Number(supplierId), notes: notes.trim() || undefined, items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })) }),
    onSuccess: (po) => { show(t("purchasing.poCreated", { number: po.number }), "success"); qc.invalidateQueries({ queryKey: ["pos"] }); onCreated(); onClose(); },
    onError: (e) => show(describeApiError(e, t("purchasing.createFailed")), "error"),
  });

  return (
    <Modal title={t("purchasing.newPurchaseOrder")} onClose={onClose} size="lg">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
        <Select label={t("purchasing.supplier")} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={suppliers.map((s) => ({ value: String(s.id), label: s.name }))} />
        <Field label={t("purchasing.addProducts")} placeholder={t("purchasing.searchByNameBarcode")} value={search} onChange={(e) => setSearch(e.target.value)} />
        {search.trim() && (
          <ul className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {products.slice(0, 20).map((p) => (
              <li key={p.id}>
                <button type="button" disabled={lines.some((l) => l.productId === p.id)} onClick={() => { setLines((ls) => [...ls, { productId: p.id, name: p.name, quantity: "1", unitCost: String(p.purchasePrice) }]); setSearch(""); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand/5 disabled:opacity-40">
                  <span>{p.name}</span><span className="text-xs text-foreground-muted">{t("purchasing.stockCount", { count: p.stock })}</span>
                </button>
              </li>
            ))}
            {products.length === 0 && <li className="px-3 py-2 text-sm text-foreground-muted">{t("purchasing.noMatchingProducts")}</li>}
          </ul>
        )}
        {lines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-foreground-muted">{t("purchasing.searchAndPick")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {lines.map((l) => (
              <div key={l.productId} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                <input aria-label={t("purchasing.qtyFor", { name: l.name })} type="number" min={0} step="0.001" value={l.quantity} onChange={(e) => update(l.productId, { quantity: e.target.value })} className="tabular w-20 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
                <input aria-label={t("purchasing.unitCostFor", { name: l.name })} type="number" min={0} step="0.01" value={l.unitCost} onChange={(e) => update(l.productId, { unitCost: e.target.value })} className="tabular w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
                <button type="button" aria-label={t("purchasing.removeLine", { name: l.name })} onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))} className="text-foreground/40 hover:text-danger"><X className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            ))}
            <p className="tabular text-right text-sm font-semibold">{t("purchasing.totalAmount", { amount: formatMoney(total, sym) })}</p>
          </div>
        )}
        <Field label={t("purchasing.notesOptional")} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? t("purchasing.creating") : t("purchasing.createPurchaseOrder")}</Button>
      </form>
    </Modal>
  );
}

function ReceiveDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const { t } = useTranslation();
  const { data: po } = useQuery({ queryKey: ["po", id], queryFn: () => api.get<PODetail>(`/purchasing/orders/${id}`) });
  const [qty, setQty] = useState<Record<number, string>>({});

  const receive = useMutation({
    mutationFn: () =>
      api.post(`/purchasing/orders/${id}/receive`, {
        items: po!.items
          .map((i) => ({ itemId: i.id, quantity: Number(qty[i.id] ?? i.quantity - i.receivedQty) }))
          .filter((i) => i.quantity > 0),
      }),
    onSuccess: () => { show(t("purchasing.stockReceived"), "success"); qc.invalidateQueries({ queryKey: ["pos"] }); qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["reorder"] }); onClose(); },
    onError: (e) => show(describeApiError(e, t("purchasing.receiveFailed")), "error"),
  });

  return (
    <Modal title={po ? t("purchasing.receiveTitle", { number: po.number }) : t("purchasing.receive")} onClose={onClose} size="lg">
      {!po ? <p>{t("purchasing.loading")}</p> : (
        <div className="flex flex-col gap-3">
          {po.items.map((i) => (
            <div key={i.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{i.name}<span className="ml-2 text-xs font-normal text-foreground-muted">{t("purchasing.orderedReceived", { ordered: i.quantity, received: i.receivedQty })}</span></p>
                <input aria-label={t("purchasing.qtyReceivedFor", { name: i.name })} type="number" min={0} step="0.001" value={qty[i.id] ?? String(Math.max(0, i.quantity - i.receivedQty))} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} className="tabular w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
              </div>
            </div>
          ))}
          <Button onClick={() => receive.mutate()} disabled={receive.isPending}>{receive.isPending ? t("purchasing.saving") : t("purchasing.addToStock")}</Button>
        </div>
      )}
    </Modal>
  );
}
