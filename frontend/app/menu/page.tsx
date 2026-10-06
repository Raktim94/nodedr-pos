"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Minus, Plus, ShoppingBag } from "lucide-react";

// Public QR menu. Customers scan a table/counter QR (…/menu?table=4), browse
// the catalogue, and place a dine-in or pickup order. Prices and totals are
// computed by the server — this page only sends item ids and quantities.
interface MenuItem { id: number; name: string; category: string; unit: string | null; price: number; available: number }
interface Menu { shop: { shopName: string; currencySymbol: string } | null; items: MenuItem[] }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/public${path}`, { ...init, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong");
  return body as T;
}

function MenuInner() {
  const table = useSearchParams().get("table") ?? "";
  const [menu, setMenu] = useState<Menu | null>(null);
  const [err, setErr] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<{ id: number; pickupCode: string; total: number } | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    call<Menu>("/menu").then(setMenu).catch((e) => setErr(e.message));
  }, []);

  // Poll the order status after placing it (every 8 s, only while open).
  useEffect(() => {
    if (!placed) return;
    const t = setInterval(() => {
      call<{ status: string }>(`/order/${placed.id}?code=${placed.pickupCode}`).then((o) => setStatus(o.status)).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [placed]);

  const sym = menu?.shop?.currencySymbol ?? "";
  const byCat = useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const i of menu?.items ?? []) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()];
  }, [menu]);
  const lines = (menu?.items ?? []).filter((i) => cart[i.id] > 0);
  const total = lines.reduce((s, i) => s + i.price * cart[i.id], 0);

  async function place() {
    setBusy(true);
    setErr("");
    try {
      const r = await call<{ id: number; pickupCode: string; total: number; status: string }>("/menu/order", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || undefined, tableNo: table || undefined, fulfilment: table ? "DINE_IN" : "PICKUP", items: lines.map((l) => ({ productId: l.id, quantity: cart[l.id] })) }),
      });
      setPlaced(r);
      setStatus(r.status);
      setCart({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not place the order");
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm font-medium text-foreground-muted">Order received{table ? ` · Table ${table}` : ""}</p>
        <p className="text-5xl font-semibold tracking-[0.2em]" aria-label={`Pickup code ${placed.pickupCode.split("").join(" ")}`}>{placed.pickupCode}</p>
        <p className="text-foreground-muted">Show this code at the counter. Total <b className="tabular text-foreground">{sym} {placed.total.toFixed(2)}</b></p>
        <p role="status" className="rounded-full bg-brand-soft px-4 py-1.5 text-sm font-semibold text-brand">{status === "NEW" ? "Waiting for the shop" : status === "PACKING" ? "Being prepared" : status === "READY" ? "Ready!" : status === "COLLECTED" ? "Collected — thank you" : status}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-40">
      <h1 className="text-2xl font-semibold tracking-tight">{menu?.shop?.shopName ?? "Menu"}</h1>
      <p className="mb-4 text-sm text-foreground-muted">{table ? `Ordering for table ${table}` : "Order for pickup"}</p>
      {err && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      {!menu && !err && <p className="text-foreground-muted">Loading menu…</p>}
      {menu && menu.items.length === 0 && <p className="text-foreground-muted">Nothing is available to order right now.</p>}
      {byCat.map(([cat, items]) => (
        <section key={cat} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">{cat}</h2>
          <ul className="card-surface divide-y divide-border">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.name}</p>
                  <p className="tabular text-sm text-foreground-muted">{sym} {i.price.toFixed(2)}{i.unit ? ` / ${i.unit}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" aria-label={`Remove one ${i.name}`} disabled={!cart[i.id]} onClick={() => setCart((c) => ({ ...c, [i.id]: Math.max(0, (c[i.id] || 0) - 1) }))} className="flex h-11 w-11 items-center justify-center rounded-full border border-border disabled:opacity-40"><Minus className="h-4 w-4" aria-hidden="true" /></button>
                  <span className="tabular w-6 text-center">{cart[i.id] || 0}</span>
                  <button type="button" aria-label={`Add one ${i.name}`} disabled={(cart[i.id] || 0) >= Math.min(50, i.available)} onClick={() => setCart((c) => ({ ...c, [i.id]: (c[i.id] || 0) + 1 }))} className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-brand-foreground disabled:opacity-40"><Plus className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {lines.length > 0 && (
        <form
          onSubmit={(e) => { e.preventDefault(); place(); }}
          className="fixed inset-x-0 bottom-0 border-t border-border bg-surface p-4 shadow-[var(--shadow-float)]"
        >
          <div className="mx-auto flex max-w-2xl flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={80} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" aria-label="Phone" inputMode="tel" maxLength={20} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm" />
            </div>
            <button type="submit" disabled={busy || !name.trim()} className="press flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-brand-foreground disabled:opacity-50">
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              {busy ? "Placing…" : `Place order · ${sym} ${total.toFixed(2)}`}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

export default function MenuPage() {
  return (
    <Suspense fallback={null}>
      <MenuInner />
    </Suspense>
  );
}
