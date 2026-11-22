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
import { useTranslation } from "@/components/I18nProvider";
import { transferStatusKey } from "@/lib/enumLabels";
import type { TranslationKey } from "@/lib/i18n";

interface Overview { branches: { id: number; code: string; name: string; lastSyncAt: string | null; today: { revenue: number; bills: number }; week: { revenue: number; cost: number; bills: number } }[]; totals: { todayRevenue: number; weekRevenue: number }; trend: { day: string; revenue: number }[] }
interface InvRow { barcode: string; name: string; category: string | null; branches: Record<number, number> }
interface Transfer { id: number; fromBranchId: number; toBranchId: number; status: string; createdAt: string; items: { barcode: string; name: string; quantity: number }[] }

const transferLabel = (t: (key: TranslationKey) => string, status: string) => {
  const key = transferStatusKey(status);
  return key ? t(key) : status.toLowerCase();
};

// Hub view: consolidated sales, stock across branches, and stock transfers.
// Franchisor accounts see this read-only (buttons are hidden, the server
// refuses writes regardless).
export default function BranchesPage() {
  const { data: shop } = useShopSettings();
  const sym = shop?.currencySymbol ?? "Rs.";
  const { data: me } = useMe();
  const readOnly = me?.role === "franchisor";
  const { show } = useToast();
  const { t } = useTranslation();
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

  if (!enabled) return <EmptyState title={t("branches.notHub")} hint={t("branches.notHubHint")} />;

  return (
    <div>
      <PageHeader title={t("branches.title")} subtitle={t("branches.subtitle")}
        actions={!readOnly && <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" /> {t("branches.add")}</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} accent label={t("branches.statToday")} value={formatMoney(ov?.totals.todayRevenue ?? 0, sym)} />
        <StatCard index={1} label={t("branches.statWeek")} value={formatMoney(ov?.totals.weekRevenue ?? 0, sym)} />
        <StatCard index={2} label={t("branches.statCount")} value={ov?.branches.length ?? 0} />
        <StatCard index={3} label={t("branches.statTransfers")} value={transfers.filter((tr) => tr.status !== "RECEIVED").length} />
      </div>

      <ul className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(ov?.branches ?? []).map((b, i) => {
          const stale = !b.lastSyncAt || Date.now() - new Date(b.lastSyncAt).getTime() > 30 * 60_000;
          return (
            <li key={b.id} className="rise card-surface p-5" style={{ "--i": i } as React.CSSProperties}>
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold">{b.name}</p><p className="font-mono text-xs text-foreground-muted">{b.code}</p></div>
                <Badge tone={stale ? "warn" : "good"}>{b.lastSyncAt ? t("branches.synced", { time: new Date(b.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : t("branches.neverSynced")}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-foreground-muted">{t("branches.today")}</dt><dd className="tabular font-semibold">{formatMoney(b.today.revenue, sym)}</dd></div>
                <div><dt className="text-foreground-muted">{t("branches.days7")}</dt><dd className="tabular font-semibold">{formatMoney(b.week.revenue, sym)}</dd></div>
              </dl>
            </li>
          );
        })}
      </ul>

      <section className="card-surface mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t("branches.stockAcross")}</h2>
          <div className="flex items-center gap-2 rounded-lg border border-border px-3"><Search className="h-4 w-4 text-foreground-muted" aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("branches.searchProduct")} aria-label={t("branches.searchProduct")} className="bg-transparent py-2 text-sm outline-none" /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs text-foreground-muted"><tr><th className="py-2 pr-3">{t("branches.colProduct")}</th>{ov?.branches.map((b) => <th key={b.id} className="py-2 pr-3 text-right">{b.code}</th>)}<th /></tr></thead>
            <tbody className="divide-y divide-border">
              {inv.map((r) => (
                <tr key={r.barcode}>
                  <td className="py-2 pr-3 font-medium">{r.name}<div className="font-mono text-xs font-normal text-foreground-muted">{r.barcode}</div></td>
                  {ov?.branches.map((b) => <td key={b.id} className={`tabular py-2 pr-3 text-right ${(r.branches[b.id] ?? 0) <= 0 ? "text-danger" : ""}`}>{r.branches[b.id] ?? "—"}</td>)}
                  <td className="py-2 text-right">{!readOnly && <Button variant="ghost" aria-label={t("branches.transferAria", { name: r.name })} onClick={() => setXfer(r)}><ArrowRightLeft className="h-4 w-4" aria-hidden="true" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inv.length === 0 && <p className="py-6 text-center text-sm text-foreground-muted">{t("branches.noStock")}</p>}
        </div>
      </section>

      <section className="card-surface p-5">
        <h2 className="mb-3 text-base font-semibold">{t("branches.transfers")}</h2>
        <ul className="divide-y divide-border text-sm">
          {transfers.map((tr) => (
            <li key={tr.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>#{tr.id} · {branchName(tr.fromBranchId)} → {branchName(tr.toBranchId)} · {tr.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</span>
              <span className="flex items-center gap-2"><Badge tone={tr.status === "RECEIVED" ? "good" : tr.status === "SHIPPED" ? "brand" : "neutral"}>{transferLabel(t, tr.status)}</Badge>
                {!readOnly && tr.status === "PENDING" && <Button variant="ghost" onClick={() => api.post(`/hub/transfers/${tr.id}/cancel`).then(() => qc.invalidateQueries({ queryKey: ["hub"] }))}>{t("branches.cancel")}</Button>}</span>
            </li>
          ))}
          {transfers.length === 0 && <li className="py-4 text-foreground-muted">{t("branches.noTransfers")}</li>}
        </ul>
      </section>

      {addOpen && <AddBranch onClose={() => setAddOpen(false)} onCreated={(code, s) => { setAddOpen(false); setSecret({ code, secret: s }); qc.invalidateQueries({ queryKey: ["hub"] }); }} withConfirm={withPasswordConfirm} />}
      {secret && (
        <Modal title={t("branches.createdTitle", { code: secret.code })} onClose={() => setSecret(null)} size="sm" closeOnBackdrop={false}>
          <p className="mb-2 text-sm">{t("branches.secretHint1")}<b>{t("branches.secretSettings")}</b>{t("branches.secretHint2")}<b>{t("branches.secretOnce")}</b>.</p>
          <code className="block break-all rounded-lg bg-surface-muted p-3 font-mono text-xs">{secret.secret}</code>
          <Button className="mt-3 w-full" variant="secondary" onClick={() => { navigator.clipboard?.writeText(secret.secret); show(t("branches.copied"), "success"); }}><Copy className="h-4 w-4" aria-hidden="true" /> {t("branches.copy")}</Button>
        </Modal>
      )}
      {xfer && ov && <TransferDialog row={xfer} branches={ov.branches} onClose={() => setXfer(null)} onDone={() => { setXfer(null); qc.invalidateQueries({ queryKey: ["hub"] }); }} />}
    </div>
  );
}

function AddBranch({ onClose, onCreated, withConfirm }: { onClose: () => void; onCreated: (code: string, secret: string) => void; withConfirm: ReturnType<typeof usePasswordConfirm>["withPasswordConfirm"] }) {
  const { show } = useToast();
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  return (
    <Modal title={t("branches.add")} onClose={onClose} size="sm">
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await withConfirm(t("branches.confirmAdd"), (confirmPassword) => api.post<{ code: string; secret: string }>("/hub/branches", { code, name, confirmPassword }));
          if (r) onCreated(r.code, r.secret);
        } catch (err) { show(describeApiError(err, t("branches.couldNotAdd")), "error"); }
      }}>
        <Field label={t("branches.codeLabel")} required value={code} onChange={(e) => setCode(e.target.value)} />
        <Field label={t("branches.nameLabel")} required value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!code || !name}>{t("branches.create")}</Button>
      </form>
    </Modal>
  );
}

function TransferDialog({ row, branches, onClose, onDone }: { row: InvRow; branches: Overview["branches"]; onClose: () => void; onDone: () => void }) {
  const { show } = useToast();
  const { t } = useTranslation();
  const [from, setFrom] = useState(String(branches[0]?.id ?? ""));
  const [to, setTo] = useState(String(branches[1]?.id ?? ""));
  const [qty, setQty] = useState("1");
  const run = useMutation({
    mutationFn: () => api.post("/hub/transfers", { fromBranchId: Number(from), toBranchId: Number(to), items: [{ barcode: row.barcode, quantity: Number(qty) }] }),
    onSuccess: () => { show(t("branches.transferCreated"), "success"); onDone(); },
    onError: (e) => show(describeApiError(e, t("branches.transferFailed")), "error"),
  });
  return (
    <Modal title={t("branches.transferTitle", { name: row.name })} onClose={onClose} size="sm">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
        {([["branches.from", from, setFrom], ["branches.to", to, setTo]] as [TranslationKey, string, (v: string) => void][]).map(([label, val, set]) => (
          <label key={label} className="flex flex-col gap-1.5 text-sm font-medium">{t(label)}
            <select value={val} onChange={(e) => set(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} {t("branches.inStock", { count: row.branches[b.id] ?? 0 })}</option>)}
            </select>
          </label>
        ))}
        <Field label={t("branches.quantity")} type="number" min={0.001} step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
        <Button type="submit" disabled={run.isPending || from === to}>{t("branches.createTransfer")}</Button>
      </form>
    </Modal>
  );
}
