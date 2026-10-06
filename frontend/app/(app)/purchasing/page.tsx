"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, PackageCheck, Plus, Send, Truck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Badge, EmptyState, PageHeader } from "@/components/ui/Bits";
import { Modal } from "@/components/ui/Modal";
import { api, describeApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import type { Supplier } from "@/lib/types";

interface ReorderGroup { supplierId: number | null; supplierName: string; items: { productId: number; name: string; stock: number; reorderPoint: number; unit: string | null; unitCost: number; suggestedQty: number }[] }
interface PO { id: number; number: string; status: "DRAFT" | "SENT" | "RECEIVED" | "CANCELLED"; totalCost: number; createdAt: string; supplier: { name: string }; _count: { items: number } }
interface PODetail extends PO { items: { id: number; productId: number; name: string; quantity: number; unitCost: number; receivedQty: number }[] }

const tone = { DRAFT: "neutral", SENT: "brand", RECEIVED: "good", CANCELLED: "bad" } as const;

export default function PurchasingPage() {
  const { data: shop } = useShopSettings();
  const sym = shop?.currencySymbol ?? "Rs.";
  const { show } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"reorder" | "orders" | "suppliers">("reorder");
  const [receiving, setReceiving] = useState<number | null>(null);
  const [supplierDialog, setSupplierDialog] = useState(false);

  const { data: reorder = [] } = useQuery({ queryKey: ["reorder"], queryFn: () => api.get<ReorderGroup[]>("/purchasing/reorder") });
  const { data: orders = [] } = useQuery({ queryKey: ["pos"], queryFn: () => api.get<PO[]>("/purchasing/orders") });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get<Supplier[]>("/purchasing/suppliers") });

  const createPo = useMutation({
    mutationFn: (g: ReorderGroup) => api.post<PO>("/purchasing/orders", { supplierId: g.supplierId, items: g.items.map((i) => ({ productId: i.productId, quantity: i.suggestedQty, unitCost: i.unitCost })) }),
    onSuccess: (po) => { show(`${po.number} created`, "success"); qc.invalidateQueries({ queryKey: ["pos"] }); setTab("orders"); },
    onError: (e) => show(describeApiError(e, "Could not create the order"), "error"),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patch(`/purchasing/orders/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
    onError: (e) => show(describeApiError(e, "Failed"), "error"),
  });

  return (
    <div>
      <PageHeader title="Purchasing" subtitle="Suppliers, low-stock reorder suggestions and purchase orders." actions={<Button onClick={() => setSupplierDialog(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Supplier</Button>} />
      <div role="tablist" aria-label="Purchasing" className="mb-4 inline-flex rounded-xl border border-border bg-surface p-1">
        {([["reorder", `Reorder (${reorder.reduce((n, g) => n + g.items.length, 0)})`], ["orders", "Purchase orders"], ["suppliers", "Suppliers"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === k ? "bg-brand text-brand-foreground" : "text-foreground-muted hover:text-foreground"}`}>{label}</button>
        ))}
      </div>

      {tab === "reorder" && (
        <div className="space-y-4">
          {reorder.length === 0 && <EmptyState icon={<PackageCheck className="h-8 w-8" />} title="Nothing to reorder" hint="Set a reorder point on a product (Inventory → edit) and it appears here when stock runs low." />}
          {reorder.map((g) => (
            <section key={g.supplierName} className="rise card-surface p-5">
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4 text-foreground-muted" aria-hidden="true" />{g.supplierName}</h2>
                <Button disabled={!g.supplierId || createPo.isPending} title={g.supplierId ? undefined : "Assign a supplier to these products first"} onClick={() => createPo.mutate(g)}>Create purchase order</Button>
              </header>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-foreground-muted"><tr><th className="py-1.5">Product</th><th className="py-1.5 text-right">Stock</th><th className="py-1.5 text-right">Reorder at</th><th className="py-1.5 text-right">Suggest</th></tr></thead>
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
            <thead className="text-xs text-foreground-muted"><tr><th className="p-3">Order</th><th className="p-3">Supplier</th><th className="p-3">Status</th><th className="p-3 text-right">Total</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="p-3 font-medium">{o.number}<div className="text-xs font-normal text-foreground-muted">{new Date(o.createdAt).toLocaleDateString()} · {o._count.items} items</div></td>
                  <td className="p-3">{o.supplier.name}</td>
                  <td className="p-3"><Badge tone={tone[o.status]}>{o.status.toLowerCase()}</Badge></td>
                  <td className="tabular p-3 text-right">{formatMoney(o.totalCost, sym)}</td>
                  <td className="p-3"><div className="flex justify-end gap-1.5">
                    <a href={`/api/purchasing/orders/${o.id}/pdf`} download><Button variant="ghost" aria-label={`Download ${o.number} PDF`}><FileDown className="h-4 w-4" aria-hidden="true" /></Button></a>
                    {o.status === "DRAFT" && <Button variant="secondary" onClick={() => setStatus.mutate({ id: o.id, status: "SENT" })}><Send className="h-4 w-4" aria-hidden="true" /> Mark sent</Button>}
                    {(o.status === "DRAFT" || o.status === "SENT") && <Button onClick={() => setReceiving(o.id)}><PackageCheck className="h-4 w-4" aria-hidden="true" /> Receive</Button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <EmptyState title="No purchase orders yet" />}
        </div>
      )}

      {tab === "suppliers" && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s, i) => (
            <li key={s.id} className="rise card-surface p-4" style={{ "--i": i } as React.CSSProperties}>
              <p className="font-semibold">{s.name}</p>
              <p className="text-sm text-foreground-muted">{[s.phone, s.email].filter(Boolean).join(" · ") || "No contact"}</p>
              {s.gstin && <p className="mt-1 font-mono text-xs text-foreground-muted">GSTIN {s.gstin}</p>}
            </li>
          ))}
          {suppliers.length === 0 && <EmptyState title="No suppliers yet" hint="Add one, then assign it to products in Inventory." />}
        </ul>
      )}

      {supplierDialog && <SupplierDialog onClose={() => setSupplierDialog(false)} />}
      {receiving != null && <ReceiveDialog id={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}

function SupplierDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [f, setF] = useState({ name: "", phone: "", email: "", gstin: "" });
  const save = useMutation({
    mutationFn: () => api.post("/purchasing/suppliers", f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["suppliers"] }); onClose(); },
    onError: (e) => show(describeApiError(e, "Could not save"), "error"),
  });
  return (
    <Modal title="Add supplier" onClose={onClose} size="sm">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Field label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Field label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Field label="GSTIN" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
        <Button type="submit" disabled={save.isPending || !f.name.trim()}>Save supplier</Button>
      </form>
    </Modal>
  );
}

function ReceiveDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { show } = useToast();
  const { data: po } = useQuery({ queryKey: ["po", id], queryFn: () => api.get<PODetail>(`/purchasing/orders/${id}`) });
  const [qty, setQty] = useState<Record<number, string>>({});

  const receive = useMutation({
    mutationFn: () =>
      api.post(`/purchasing/orders/${id}/receive`, {
        items: po!.items
          .map((i) => ({ itemId: i.id, quantity: Number(qty[i.id] ?? i.quantity - i.receivedQty) }))
          .filter((i) => i.quantity > 0),
      }),
    onSuccess: () => { show("Stock received", "success"); qc.invalidateQueries({ queryKey: ["pos"] }); qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["reorder"] }); onClose(); },
    onError: (e) => show(describeApiError(e, "Could not receive"), "error"),
  });

  return (
    <Modal title={po ? `Receive ${po.number}` : "Receive"} onClose={onClose} size="lg">
      {!po ? <p>Loading…</p> : (
        <div className="flex flex-col gap-3">
          {po.items.map((i) => (
            <div key={i.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{i.name}<span className="ml-2 text-xs font-normal text-foreground-muted">ordered {i.quantity} · received {i.receivedQty}</span></p>
                <input aria-label={`Quantity received for ${i.name}`} type="number" min={0} step="0.001" value={qty[i.id] ?? String(Math.max(0, i.quantity - i.receivedQty))} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} className="tabular w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
              </div>
            </div>
          ))}
          <Button onClick={() => receive.mutate()} disabled={receive.isPending}>{receive.isPending ? "Saving…" : "Add to stock"}</Button>
        </div>
      )}
    </Modal>
  );
}
