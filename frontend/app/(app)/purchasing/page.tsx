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
  const [supplierDialog, setSupplierDialog] = useState<Supplier | "new" | null>(null);
  const [poDialog, setPoDialog] = useState(false);

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
      <PageHeader title="Purchasing" subtitle="Suppliers, low-stock reorder suggestions and purchase orders." actions={<div className="flex gap-2"><Button variant="secondary" onClick={() => setSupplierDialog("new")}><Plus className="h-4 w-4" aria-hidden="true" /> Supplier</Button><Button onClick={() => setPoDialog(true)} disabled={suppliers.length === 0} title={suppliers.length === 0 ? "Add a supplier first" : undefined}><Plus className="h-4 w-4" aria-hidden="true" /> New purchase order</Button></div>} />
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
                    {(o.status === "DRAFT" || o.status === "SENT") && <Button variant="ghost" aria-label={`Cancel ${o.number}`} title="Cancel order" onClick={() => { if (window.confirm(`Cancel ${o.number}?`)) setStatus.mutate({ id: o.id, status: "CANCELLED" }); }}><X className="h-4 w-4" aria-hidden="true" /></Button>}
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
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{s.name}</p>
                <button type="button" aria-label={`Edit ${s.name}`} title="Edit supplier" onClick={() => setSupplierDialog(s)} className="text-foreground/40 hover:text-brand"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
              </div>
              <p className="text-sm text-foreground-muted">{[s.phone, s.email].filter(Boolean).join(" · ") || "No contact"}</p>
              {s.gstin && <p className="mt-1 font-mono text-xs text-foreground-muted">GSTIN {s.gstin}</p>}
            </li>
          ))}
          {suppliers.length === 0 && <EmptyState title="No suppliers yet" hint="Add one, then assign it to products in Inventory." />}
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
  const [f, setF] = useState({ name: supplier?.name ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", address: supplier?.address ?? "", gstin: supplier?.gstin ?? "", notes: supplier?.notes ?? "" });
  const done = () => { qc.invalidateQueries({ queryKey: ["suppliers"] }); qc.invalidateQueries({ queryKey: ["reorder"] }); qc.invalidateQueries({ queryKey: ["products"] }); onClose(); };
  const save = useMutation({
    mutationFn: () => (supplier ? api.put(`/purchasing/suppliers/${supplier.id}`, f) : api.post("/purchasing/suppliers", f)),
    onSuccess: () => { show(supplier ? "Supplier updated" : "Supplier added", "success"); done(); },
    onError: (e) => show(describeApiError(e, "Could not save"), "error"),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/purchasing/suppliers/${supplier!.id}`),
    onSuccess: () => { show("Supplier deleted", "success"); done(); },
    onError: (e) => show(describeApiError(e, "Could not delete"), "error"),
  });
  return (
    <Modal title={supplier ? "Edit supplier" : "Add supplier"} onClose={onClose} size="sm">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Field label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Field label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Field label="Address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        <Field label="GSTIN" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
        <Field label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <Button type="submit" disabled={save.isPending || !f.name.trim()}>{supplier ? "Save changes" : "Save supplier"}</Button>
        {supplier && (
          <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete "${supplier.name}"? Products using it become unassigned.`)) remove.mutate(); }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete supplier
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
    onSuccess: (po) => { show(`${po.number} created`, "success"); qc.invalidateQueries({ queryKey: ["pos"] }); onCreated(); onClose(); },
    onError: (e) => show(describeApiError(e, "Could not create the order"), "error"),
  });

  return (
    <Modal title="New purchase order" onClose={onClose} size="lg">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
        <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={suppliers.map((s) => ({ value: String(s.id), label: s.name }))} />
        <Field label="Add products" placeholder="Search by name or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {search.trim() && (
          <ul className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {products.slice(0, 20).map((p) => (
              <li key={p.id}>
                <button type="button" disabled={lines.some((l) => l.productId === p.id)} onClick={() => { setLines((ls) => [...ls, { productId: p.id, name: p.name, quantity: "1", unitCost: String(p.purchasePrice) }]); setSearch(""); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand/5 disabled:opacity-40">
                  <span>{p.name}</span><span className="text-xs text-foreground-muted">stock {p.stock}</span>
                </button>
              </li>
            ))}
            {products.length === 0 && <li className="px-3 py-2 text-sm text-foreground-muted">No matching products.</li>}
          </ul>
        )}
        {lines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-foreground-muted">Search above and pick the products to order.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {lines.map((l) => (
              <div key={l.productId} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                <input aria-label={`Quantity for ${l.name}`} type="number" min={0} step="0.001" value={l.quantity} onChange={(e) => update(l.productId, { quantity: e.target.value })} className="tabular w-20 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
                <input aria-label={`Unit cost for ${l.name}`} type="number" min={0} step="0.01" value={l.unitCost} onChange={(e) => update(l.productId, { unitCost: e.target.value })} className="tabular w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
                <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))} className="text-foreground/40 hover:text-danger"><X className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            ))}
            <p className="tabular text-right text-sm font-semibold">Total {formatMoney(total, sym)}</p>
          </div>
        )}
        <Field label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? "Creating…" : "Create purchase order"}</Button>
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
