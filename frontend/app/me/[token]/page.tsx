"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FileText, Gift, Wallet } from "lucide-react";

// Customer portal (installable PWA): loyalty balance, dues, recent receipts
// and shop announcements. The signed link in the URL is the credential.
interface Portal {
  shop: { shopName: string; currencySymbol: string; loyaltyEnabled: boolean; phone: string | null };
  customer: { name: string; loyaltyPoints: number; totalDue: number; creditBalance: number; visits: number };
  announcements: { title: string; body: string; createdAt: string }[];
  receipts: { invoiceNumber: string; totalAmount: number; createdAt: string; url: string }[];
}

export default function CustomerPortal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Portal | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/public/customer/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("This link is not valid any more — ask the shop for a new one.");
        setData(await r.json());
      })
      .catch((e) => setErr(e.message));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, [token]);

  if (err) return <main className="mx-auto max-w-md p-6"><p role="alert" className="rounded-xl bg-danger-soft p-4 text-danger">{err}</p></main>;
  if (!data) return <main className="mx-auto max-w-md p-6 text-foreground-muted">Loading…</main>;
  const sym = data.shop.currencySymbol;

  return (
    <main className="mx-auto max-w-md p-4 pb-12">
      <p className="text-sm text-foreground-muted">{data.shop.shopName}</p>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Hi, {data.customer.name.split(" ")[0]}</h1>
      <div className="mb-4 grid grid-cols-2 gap-3">
        {data.shop.loyaltyEnabled && (
          <div className="tile-dark rounded-2xl p-4">
            <Gift className="mb-2 h-5 w-5" aria-hidden="true" />
            <p className="num-xl">{data.customer.loyaltyPoints}</p>
            <p className="text-xs text-white/70">loyalty points</p>
          </div>
        )}
        <div className="card-surface p-4">
          <Wallet className="mb-2 h-5 w-5 text-brand" aria-hidden="true" />
          <p className="num-xl">{sym} {(data.customer.creditBalance - data.customer.totalDue).toFixed(2)}</p>
          <p className="text-xs text-foreground-muted">{data.customer.totalDue > 0 ? "balance (you owe the shop)" : "store credit"}</p>
        </div>
      </div>

      {data.announcements.length > 0 && (
        <section className="mb-4 space-y-2" aria-label="Announcements">
          {data.announcements.map((a, i) => (
            <div key={i} className="rounded-2xl bg-brand-soft p-4">
              <p className="text-sm font-semibold text-brand">{a.title}</p>
              <p className="text-sm">{a.body}</p>
            </div>
          ))}
        </section>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">Recent receipts</h2>
      <ul className="card-surface divide-y divide-border">
        {data.receipts.length === 0 && <li className="p-4 text-sm text-foreground-muted">No purchases yet.</li>}
        {data.receipts.map((r) => (
          <li key={r.invoiceNumber}>
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex min-h-[56px] items-center gap-3 p-4 hover:bg-surface-muted">
              <FileText className="h-5 w-5 text-foreground-muted" aria-hidden="true" />
              <span className="flex-1">
                <span className="block text-sm font-medium">{r.invoiceNumber}</span>
                <span className="text-xs text-foreground-muted">{new Date(r.createdAt).toLocaleDateString()}</span>
              </span>
              <span className="tabular text-sm font-semibold">{sym} {r.totalAmount.toFixed(2)}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
