"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Copy, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui/Bits";
import { Modal } from "@/components/ui/Modal";
import { api, describeApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useMe } from "@/hooks/useAuth";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useToast } from "@/components/Toast";

interface Overview { branches: { id: number; code: string; name: string; lastSyncAt: string | null; today: { revenue: number; bills: number }; week: { revenue: number; cost: number; bills: number } }[]; totals: { todayRevenue: number; weekRevenue: number }; trend: { day: string; revenue: number }[] }
interface InvRow { barcode: string; name: string; category: string | null; branches: Record<number, number> }
interface Transfer { id: number; fromBranchId: number; toBranchId: number; status: string; createdAt: string; items: { barcode: string; name: string; quantity: number }[] }

// Hub view: consolidated sales, stock across branches, and stock transfers.
// Franchisor accounts see this read-only (buttons are hidden, the server
// refuses writes regardless).
export default function BranchesPage() {
  const { data: shop } = useShopSettings();
  const sym = shop?.currencySymbol ?? "Rs.";
  const { data: me } = useMe();
  const readOnly = me?.role === "franchisor";
  const { show } = useToast();
  const { withPasswordConfirm } = usePasswordConfirm();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [xfer, setXfer] = useState<InvRow | null>(null);
  const [secret, setSecret] = useState<{ code: string; secret: string } | null>(null);

  const enabled = shop?.syncRole === "hub";
  const { data: ov } = useQuery({ queryKey: ["hub", "overview"], queryFn: () => api.get<Overview>("/hub/overview"), enabled, refetchInterval: 60_000 });
  const { data: inv = [] } = useQuery({ queryKey: ["hub", "inv", q], queryFn: () => api.get<InvRow[]>(`/hub/inventory?q=${encodeURIComponent(q)}`), enabled });
  const { data: transfers = [] } = useQuery({ queryKey: ["hub", "transfers"], queryFn: () => api.get<Transfer[]>("/hub/transfers"), enabled });
  const branchName = (id: number) => ov?.branches.find((b) => b.id === id)?.name ?? `#${id}`;

  if (!enabled) return <EmptyState title="This instance is not a hub" hint="Turn on Settings → Branches → “This is the hub” to consolidate several shops here." />;

  return (
    <div>
      <PageHeader title="Branches" subtitle="Consolidated sales and stock from every connected shop. Data is pushed by each branch, encrypted, to this server only."
        actions={!readOnly && <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Add branch</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} accent label="Today, all branches" value={formatMoney(ov?.totals.todayRevenue ?? 0, sym)} />
        <StatCard index={1} label="Last 7 days" value={formatMoney(ov?.totals.weekRevenue ?? 0, sym)} />
        <StatCard index={2} label="Branches" value={ov?.branches.length ?? 0} />
        <StatCard index={3} label="Open transfers" value={transfers.filter((t) => t.status !== "RECEIVED").length} />
      </div>

      <ul className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(ov?.branches ?? []).map((b, i) => {
          const stale = !b.lastSyncAt || Date.now() - new Date(b.lastSyncAt).getTime() > 30 * 60_000;
          return (
            <li key={b.id} className="rise card-surface p-5" style={{ "--i": i } as React.CSSProperties}>
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold">{b.name}</p><p className="font-mono text-xs text-foreground-muted">{b.code}</p></div>
                <Badge tone={stale ? "warn" : "good"}>{b.lastSyncAt ? `synced ${new Date(b.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "never synced"}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-foreground-muted">Today</dt><dd className="tabular font-semibold">{formatMoney(b.today.revenue, sym)}</dd></div>
                <div><dt className="text-foreground-muted">7 days</dt><dd className="tabular font-semibold">{formatMoney(b.week.revenue, sym)}</dd></div>
              </dl>
            </li>
          );
        })}
      </ul>

      <section className="card-surface mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Stock across branches</h2>
          <div className="flex items-center gap-2 rounded-lg border border-border px-3"><Search className="h-4 w-4 text-foreground-muted" aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product" aria-label="Search product" className="bg-transparent py-2 text-sm outline-none" /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs text-foreground-muted"><tr><th className="py-2 pr-3">Product</th>{ov?.branches.map((b) => <th key={b.id} className="py-2 pr-3 text-right">{b.code}</th>)}<th /></tr></thead>
            <tbody className="divide-y divide-border">
              {inv.map((r) => (
                <tr key={r.barcode}>
                  <td className="py-2 pr-3 font-medium">{r.name}<div className="font-mono text-xs font-normal text-foreground-muted">{r.barcode}</div></td>
                  {ov?.branches.map((b) => <td key={b.id} className={`tabular py-2 pr-3 text-right ${(r.branches[b.id] ?? 0) <= 0 ? "text-danger" : ""}`}>{r.branches[b.id] ?? "—"}</td>)}
                  <td className="py-2 text-right">{!readOnly && <Button variant="ghost" aria-label={`Transfer ${r.name}`} onClick={() => setXfer(r)}><ArrowRightLeft className="h-4 w-4" aria-hidden="true" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inv.length === 0 && <p className="py-6 text-center text-sm text-foreground-muted">No stock reported yet.</p>}
        </div>
      </section>

      <section className="card-surface p-5">
        <h2 className="mb-3 text-base font-semibold">Transfers</h2>
        <ul className="divide-y divide-border text-sm">
          {transfers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>#{t.id} · {branchName(t.fromBranchId)} → {branchName(t.toBranchId)} · {t.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</span>
              <span className="flex items-center gap-2"><Badge tone={t.status === "RECEIVED" ? "good" : t.status === "SHIPPED" ? "brand" : "neutral"}>{t.status.toLowerCase()}</Badge>
                {!readOnly && t.status === "PENDING" && <Button variant="ghost" onClick={() => api.post(`/hub/transfers/${t.id}/cancel`).then(() => qc.invalidateQueries({ queryKey: ["hub"] }))}>Cancel</Button>}</span>
            </li>
          ))}
          {transfers.length === 0 && <li className="py-4 text-foreground-muted">No transfers yet.</li>}
        </ul>
      </section>

      {addOpen && <AddBranch onClose={() => setAddOpen(false)} onCreated={(code, s) => { setAddOpen(false); setSecret({ code, secret: s }); qc.invalidateQueries({ queryKey: ["hub"] }); }} withConfirm={withPasswordConfirm} />}
      {secret && (
        <Modal title={`Branch ${secret.code} created`} onClose={() => setSecret(null)} size="sm" closeOnBackdrop={false}>
          <p className="mb-2 text-sm">Copy this sync secret into that branch&apos;s <b>Settings → Branches</b>. It is shown <b>once</b>.</p>
          <code className="block break-all rounded-lg bg-surface-muted p-3 font-mono text-xs">{secret.secret}</code>
          <Button className="mt-3 w-full" variant="secondary" onClick={() => { navigator.clipboard?.writeText(secret.secret); show("Copied", "success"); }}><Copy className="h-4 w-4" aria-hidden="true" /> Copy</Button>
        </Modal>
      )}
      {xfer && ov && <TransferDialog row={xfer} branches={ov.branches} onClose={() => setXfer(null)} onDone={() => { setXfer(null); qc.invalidateQueries({ queryKey: ["hub"] }); }} />}
    </div>
  );
}

function AddBranch({ onClose, onCreated, withConfirm }: { onClose: () => void; onCreated: (code: string, secret: string) => void; withConfirm: ReturnType<typeof usePasswordConfirm>["withPasswordConfirm"] }) {
  const { show } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  return (
    <Modal title="Add branch" onClose={onClose} size="sm">
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await withConfirm("add this branch", (confirmPassword) => api.post<{ code: string; secret: string }>("/hub/branches", { code, name, confirmPassword }));
          if (r) onCreated(r.code, r.secret);
        } catch (err) { show(describeApiError(err, "Could not add"), "error"); }
      }}>
        <Field label="Branch code (2–20 letters/digits)" required value={code} onChange={(e) => setCode(e.target.value)} />
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!code || !name}>Create</Button>
      </form>
    </Modal>
  );
}

function TransferDialog({ row, branches, onClose, onDone }: { row: InvRow; branches: Overview["branches"]; onClose: () => void; onDone: () => void }) {
  const { show } = useToast();
  const [from, setFrom] = useState(String(branches[0]?.id ?? ""));
  const [to, setTo] = useState(String(branches[1]?.id ?? ""));
  const [qty, setQty] = useState("1");
  const run = useMutation({
    mutationFn: () => api.post("/hub/transfers", { fromBranchId: Number(from), toBranchId: Number(to), items: [{ barcode: row.barcode, quantity: Number(qty) }] }),
    onSuccess: () => { show("Transfer created — the branches apply it on their next sync", "success"); onDone(); },
    onError: (e) => show(describeApiError(e, "Could not create the transfer"), "error"),
  });
  return (
    <Modal title={`Transfer · ${row.name}`} onClose={onClose} size="sm">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
        {[["From", from, setFrom], ["To", to, setTo]].map(([label, val, set]) => (
          <label key={label as string} className="flex flex-col gap-1.5 text-sm font-medium">{label as string}
            <select value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({row.branches[b.id] ?? 0} in stock)</option>)}
            </select>
          </label>
        ))}
        <Field label="Quantity" type="number" min={0.001} step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
        <Button type="submit" disabled={run.isPending || from === to}>Create transfer</Button>
      </form>
    </Modal>
  );
}
