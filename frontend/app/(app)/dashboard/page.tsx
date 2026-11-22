"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleDollarSign, Download, ShoppingBag, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, Delta, PageHeader } from "@/components/ui/Bits";
import { useLowStock } from "@/hooks/useProducts";
import { useInvoices, useSalesAnalytics, useSalesSummary } from "@/hooks/useInvoices";
import { useDueSummary, useTopDueCustomers } from "@/hooks/useCustomers";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useMe } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { can } from "@/lib/perm";
import { formatMoney } from "@/lib/format";
import { useTranslation } from "@/components/I18nProvider";
import { orderStatusKey } from "@/lib/enumLabels";
import type { TranslationKey } from "@/lib/i18n";
import type { Order } from "@/lib/types";

const statusLabel = (t: (key: TranslationKey) => string, status: string) => {
  const key = orderStatusKey(status);
  return key ? t(key) : status.toLowerCase();
};

const SalesCharts = dynamic(() => import("@/components/SalesCharts").then((m) => m.SalesCharts), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-2xl bg-surface-muted" /> });

const pct = (cur?: number, prev?: number) => (cur == null || prev == null || prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);

export default function DashboardPage() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const locale = language === "es" ? "es-ES" : "en-US";
  const { data: me } = useMe();
  const { data: shop } = useShopSettings();
  const { data: lowStock } = useLowStock();
  const { data: summary } = useSalesSummary();
  const { data: invoices } = useInvoices();
  const { data: analytics } = useSalesAnalytics();
  const { data: dueSummary } = useDueSummary();
  const { data: topDue } = useTopDueCustomers(5);
  const wantsOrders = can(me, "orders");
  const { data: orders } = useQuery({ queryKey: ["orders", "open"], queryFn: () => api.get<Order[]>("/orders?status=NEW,PACKING,READY"), enabled: wantsOrders, refetchInterval: 15_000, refetchOnWindowFocus: true });

  // Franchisor accounts only have the consolidated hub views.
  useEffect(() => {
    if (me?.role === "franchisor") router.replace("/branches");
  }, [me, router]);

  const sym = shop?.currencySymbol || "Rs.";
  const money = (n: number) => formatMoney(n, sym);
  const trend = analytics?.trend ?? [];
  const today = trend.at(-1);
  const yesterday = trend.at(-2);
  const revDelta = pct(today?.revenue, yesterday?.revenue);
  const salesDelta = pct(today?.count, yesterday?.count);
  const maxRev = Math.max(1, ...trend.map((t) => t.revenue));
  const prior = trend.slice(0, -1);
  const avg = prior.length ? prior.reduce((s, t) => s + t.revenue, 0) / prior.length : 0;
  const ringPct = avg > 0 ? Math.min(100, Math.round(((today?.revenue ?? 0) / avg) * 100)) : 0;
  const LEN = 2 * Math.PI * 42;
  const greetingKey: TranslationKey =
    new Date().getHours() < 12
      ? "dashboard.greetingMorning"
      : new Date().getHours() < 18
        ? "dashboard.greetingAfternoon"
        : "dashboard.greetingEvening";

  return (
    <div>
      <PageHeader
        title={`${t(greetingKey)}${me ? `, ${me.name.split(" ")[0]}` : ""}`}
        subtitle={t("dashboard.subtitle")}
        actions={<a href="/api/invoices/export.csv" download><Button variant="secondary" type="button"><Download className="h-4 w-4" aria-hidden="true" /> {t("dashboard.salesCsv")}</Button></a>}
      />

      {/* Bento: short KPI tiles, a larger chart, a ring, then lists. */}
      <div className="grid grid-cols-12 gap-4">
        <Kpi i={0} span="col-span-6 lg:col-span-3" accent icon={TrendingUp} label={t("dashboard.todaysRevenue")} value={money(summary?.todaysRevenue ?? 0)} sub={revDelta != null && <span className="text-white/80">{revDelta >= 0 ? "▲" : "▼"} {Math.abs(revDelta)}% {t("dashboard.vsYesterday")}</span>} />
        <Kpi i={1} span="col-span-6 lg:col-span-3" icon={ShoppingBag} label={t("dashboard.todaysBills")} value={String(summary?.todaysCount ?? 0)} sub={salesDelta != null && <Delta value={salesDelta} />} />
        <Kpi i={2} span="col-span-6 lg:col-span-3" icon={AlertTriangle} label={t("dashboard.lowStock")} value={String(lowStock?.products.length ?? 0)} tone={lowStock?.products.length ? "warn" : undefined} sub={<Link href="/inventory" className="underline-offset-2 hover:underline">{t("dashboard.reviewStock")}</Link>} />
        <Kpi i={3} span="col-span-6 lg:col-span-3" icon={CircleDollarSign} label={t("dashboard.customerDues")} value={money(dueSummary?.totalDue ?? 0)} tone={dueSummary?.totalDue ? "bad" : undefined} sub={t("dashboard.customersCount", { count: dueSummary?.customersWithDue ?? 0 })} />

        <section className="rise card-surface col-span-12 p-5 lg:col-span-8" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[0.95rem] font-semibold tracking-tight">{t("dashboard.revenueLast14")}</h2>
            <span className="text-xs text-foreground-muted">{t("dashboard.peak", { amount: money(maxRev) })}</span>
          </div>
          {trend.some((d) => d.revenue > 0) ? (
            <>
              <div className="flex h-40 items-end gap-1.5 sm:gap-2" role="img" aria-label={t("dashboard.ariaDailyRevenue", { days: trend.length, amount: money(today?.revenue ?? 0) })}>
                {trend.map((day, i) => (
                  <div key={day.date} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={t("dashboard.ariaBar", { date: new Date(day.date).toLocaleDateString(locale), amount: money(day.revenue), count: day.count })}>
                    <div className="bar-grow w-full max-w-[28px] rounded-full" style={{ height: `${Math.max(6, (day.revenue / maxRev) * 100)}%`, background: i === trend.length - 1 ? "var(--brand)" : "color-mix(in srgb, var(--brand) 22%, var(--surface-muted))", "--i": i } as React.CSSProperties} />
                    <span className="text-[10px] text-foreground-muted">{new Date(day.date).toLocaleDateString(locale, { weekday: "narrow" })}</span>
                  </div>
                ))}
              </div>
              <table className="sr-only"><caption>{t("dashboard.dailyRevenue")}</caption><tbody>{trend.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{money(day.revenue)}</td></tr>)}</tbody></table>
            </>
          ) : <p className="py-14 text-center text-sm text-foreground-muted">{t("dashboard.notEnough")}</p>}
        </section>

        <div className="col-span-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-1">
          <section className="rise card-surface flex items-center gap-4 p-5" style={{ "--i": 5 } as React.CSSProperties}>
            <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90" role="img" aria-label={t("dashboard.ringLabel", { pct: ringPct })}>
              <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-muted)" strokeWidth="9" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="var(--brand)" strokeWidth="9" strokeLinecap="round" strokeDasharray={LEN} strokeDashoffset={LEN * (1 - ringPct / 100)} className="ring-arc" style={{ "--len": LEN } as React.CSSProperties} />
            </svg>
            <div>
              <p className="num-xl">{ringPct}%</p>
              <p className="text-xs text-foreground-muted">{t("dashboard.ofUsual")}</p>
            </div>
          </section>
        </div>

        <ListCard i={6} span="lg:col-span-4" title={t("dashboard.lowInventory")} href="/inventory" empty={t("dashboard.allAbove", { threshold: lowStock?.threshold ?? 5 })} rows={(lowStock?.products ?? []).slice(0, 6).map((p) => ({ k: p.id, a: p.name, b: p.barcode, end: <Badge tone="warn">{t("dashboard.left", { count: Math.round(p.stock * 1000) / 1000 })}</Badge> }))} />
        {wantsOrders ? (
          <ListCard i={7} span="lg:col-span-4" title={t("dashboard.onlineOrders")} href="/orders" empty={t("dashboard.noOpenOrders")} rows={(orders ?? []).slice(0, 6).map((o) => ({ k: o.id, a: o.customerName, b: `${o.pickupCode} · ${t("dashboard.items", { count: o.items.length })}`, end: <Badge tone={o.status === "READY" ? "good" : "brand"}>{statusLabel(t, o.status)}</Badge> }))} />
        ) : (
          <ListCard i={7} span="lg:col-span-4" title={t("dashboard.recentInvoices")} href="/sales" empty={t("dashboard.noSales")} rows={(invoices ?? []).slice(0, 6).map((v) => ({ k: v.id, a: v.invoiceNumber, b: v.customerName, end: <span className="tabular text-sm font-semibold">{money(v.totalAmount)}</span> }))} />
        )}
        <ListCard i={8} span="lg:col-span-4" title={t("dashboard.customersWithDues")} href="/customers" empty={t("dashboard.noDues")} rows={(topDue ?? []).map((c) => ({ k: c.id, a: c.name, b: c.phone, end: <Badge tone="bad">{money(c.totalDue)}</Badge> }))} />
      </div>

      <div className="mt-4"><SalesCharts sym={sym} /></div>
    </div>
  );
}

function Kpi({ i, span, icon: Icon, label, value, sub, accent, tone }: { i: number; span: string; icon: React.ElementType; label: string; value: string; sub?: React.ReactNode; accent?: boolean; tone?: "warn" | "bad" }) {
  return (
    <div className={`rise ${span} rounded-2xl border p-5 ${accent ? "border-transparent bg-[var(--green-900)] text-white" : "card-surface"}`} style={{ "--i": i } as React.CSSProperties}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accent ? "text-white/80" : tone === "bad" ? "text-danger" : tone === "warn" ? "text-warning" : "text-brand"}`} aria-hidden="true" />
        <p className={`text-xs font-medium ${accent ? "text-white/75" : "text-foreground-muted"}`}>{label}</p>
      </div>
      <p className="num-xl mt-3 truncate">{value}</p>
      {sub && <div className={`mt-2 text-xs ${accent ? "text-white/75" : "text-foreground-muted"}`}>{sub}</div>}
    </div>
  );
}

function ListCard({ i, span, title, href, rows, empty }: { i: number; span: string; title: string; href: string; rows: { k: number; a: string; b: string; end: React.ReactNode }[]; empty: string }) {
  const { t } = useTranslation();
  return (
    <section className={`rise card-surface col-span-12 p-5 ${span}`} style={{ "--i": i } as React.CSSProperties}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[0.95rem] font-semibold tracking-tight">{title}</h2>
        <Link href={href} className="text-xs font-medium text-brand hover:underline">{t("dashboard.viewAll")}</Link>
      </div>
      {rows.length === 0 ? <p className="py-6 text-center text-sm text-foreground-muted">{empty}</p> : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.k} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{r.a}</p><p className="truncate text-xs text-foreground-muted">{r.b}</p></div>
              {r.end}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
