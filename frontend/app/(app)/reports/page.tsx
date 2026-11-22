"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Badge, Delta, PageHeader, StatCard } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Button";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useCompare, useOverview, type Row } from "@/hooks/useReports";
import { formatMoney } from "@/lib/format";
import { CATEGORY_COLORS } from "@/components/ReportsCharts";
import { useTranslation } from "@/components/I18nProvider";
import type { TranslationKey } from "@/lib/i18n";

const RevenueArea = dynamic(() => import("@/components/ReportsCharts").then((m) => m.RevenueArea), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-surface-muted" /> });
const CategoryDonut = dynamic(() => import("@/components/ReportsCharts").then((m) => m.CategoryDonut), { ssr: false, loading: () => <div className="h-52 animate-pulse rounded-xl bg-surface-muted" /> });

const WEEKDAY_KEYS: TranslationKey[] = ["reports.sun", "reports.mon", "reports.tue", "reports.wed", "reports.thu", "reports.fri", "reports.sat"];
const PERIOD_KEYS = { day: "reports.periodDay", week: "reports.periodWeek", month: "reports.periodMonth" } as const;

export default function ReportsPage() {
  const { data: shop } = useShopSettings();
  const { t } = useTranslation();
  const sym = shop?.currencySymbol ?? "Rs.";
  const money = (n: number) => formatMoney(n, sym);
  const [days, setDays] = useState(30);
  const [cmp, setCmp] = useState<"day" | "week" | "month">("week");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, isLoading, error } = useOverview(days);
  const { data: compare } = useCompare(cmp);

  const maxHeat = Math.max(1, ...(data?.heatmap.flat().map((c) => c.bills) ?? [1]));
  const cats = (data?.categories ?? []).map((c: Row) => ({ name: c.category ?? t("reports.other"), value: c.net }));

  return (
    <div>
      <PageHeader
        title={t("reports.title")}
        subtitle={data ? `${data.range.from} → ${data.range.to}` : t("reports.subtitle")}
        actions={
          <div role="group" aria-label={t("reports.dateRange")} className="flex rounded-xl border border-border bg-surface p-1">
            {[7, 30, 90].map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${days === d ? "bg-brand text-brand-foreground" : "text-foreground-muted hover:text-foreground"}`}>
                {t("reports.rangeDays", { count: d })}
              </button>
            ))}
          </div>
        }
      />
      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{t("reports.loadFailed")}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} accent label={t("reports.revenue")} value={isLoading ? "…" : money(data?.totals.revenue ?? 0)} sub={data && <span className="text-white/80">{data.deltas.revenue >= 0 ? "▲" : "▼"} {t("reports.vsPrevious", { pct: Math.abs(data.deltas.revenue) })}</span>} />
        <StatCard index={1} label={t("reports.grossProfit")} value={isLoading ? "…" : money(data?.totals.grossProfit ?? 0)} sub={data && <><Delta value={data.deltas.grossProfit} /> · {t("reports.margin", { pct: data.totals.marginPct })}</>} />
        <StatCard index={2} label={t("reports.bills")} value={isLoading ? "…" : data?.totals.bills ?? 0} sub={data && <Delta value={data.deltas.bills} />} />
        <StatCard index={3} label={t("reports.averageBill")} value={isLoading ? "…" : money(data?.totals.avgBill ?? 0)} sub={data && <Delta value={data.deltas.avgBill} />} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rise card-surface p-5 lg:col-span-2" style={{ "--i": 4 } as React.CSSProperties}>
          <h2 className="mb-3 text-base font-semibold">{t("reports.revenueByDay")}</h2>
          {data && <RevenueArea data={data.daily} sym={sym} />}
        </section>
        <section className="rise card-surface p-5" style={{ "--i": 5 } as React.CSSProperties}>
          <h2 className="mb-3 text-base font-semibold">{t("reports.byCategory")}</h2>
          {cats.length === 0 ? <p className="py-10 text-center text-sm text-foreground-muted">{t("reports.noSales")}</p> : (
            <>
              <CategoryDonut data={cats} />
              <ul className="mt-2 space-y-1.5 text-sm">
                {data!.categories.map((c, i) => (
                  <li key={c.category} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{c.category}</span>
                    <span className="tabular text-foreground-muted">{money(c.net)}</span>
                    <Badge tone={c.marginPct >= 20 ? "good" : c.marginPct >= 10 ? "warn" : "bad"}>{c.marginPct}%</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rise card-surface p-5 lg:col-span-2" style={{ "--i": 6 } as React.CSSProperties}>
          <h2 className="mb-1 text-base font-semibold">{t("reports.whenCustomersBuy")}</h2>
          <p className="mb-3 text-xs text-foreground-muted">{t("reports.heatmapHint")}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed border-separate border-spacing-1 text-[10px]" aria-label={t("reports.heatmapAria")}>
              <thead>
                <tr>
                  <th className="w-9" />
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} scope="col" className="font-normal text-foreground-muted">{h % 3 === 0 ? h : ""}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.heatmap ?? []).map((row, d) => (
                  <tr key={d}>
                    <th scope="row" className="pr-1 text-right font-medium text-foreground-muted">{t(WEEKDAY_KEYS[d])}</th>
                    {row.map((c, h) => (
                      <td key={h} title={t("reports.heatmapCell", { day: t(WEEKDAY_KEYS[d]), hour: h, count: c.bills, amount: money(c.revenue) })} className="h-5 rounded-[4px]" style={{ background: c.bills ? `color-mix(in srgb, var(--brand) ${Math.max(14, Math.round((c.bills / maxHeat) * 100))}%, transparent)` : "var(--surface-muted)" }}>
                        <span className="sr-only">{t("reports.billsCount", { count: c.bills })}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rise card-surface p-5" style={{ "--i": 7 } as React.CSSProperties}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t("reports.compare")}</h2>
            <div role="group" aria-label={t("reports.comparisonPeriod")} className="flex rounded-lg border border-border p-0.5 text-xs">
              {(["day", "week", "month"] as const).map((p) => (
                <button key={p} type="button" aria-pressed={cmp === p} onClick={() => setCmp(p)} className={`rounded-md px-2.5 py-1 font-medium capitalize ${cmp === p ? "bg-brand text-brand-foreground" : "text-foreground-muted"}`}>{t(PERIOD_KEYS[p])}</button>
              ))}
            </div>
          </div>
          {compare && (
            <dl className="space-y-3 text-sm">
              {([[t("reports.revenue"), compare.current.revenue, compare.previous.revenue, compare.deltas.revenue, true], [t("reports.grossProfit"), compare.current.grossProfit, compare.previous.grossProfit, compare.deltas.grossProfit, true], [t("reports.bills"), compare.current.bills, compare.previous.bills, compare.deltas.bills, false]] as const).map(([label, cur, prev, d, isMoney]) => (
                <div key={label}>
                  <dt className="flex items-center justify-between text-foreground-muted"><span>{label}</span><Delta value={d} /></dt>
                  <dd className="tabular"><b className="text-base">{isMoney ? money(cur) : cur}</b> <span className="text-foreground-muted">vs {isMoney ? money(prev) : prev} {cmp === "day" ? t("reports.yesterday") : t("reports.lastPeriod", { period: t(PERIOD_KEYS[cmp]) })}</span></dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      <section className="rise card-surface mb-4 overflow-x-auto p-5" style={{ "--i": 8 } as React.CSSProperties}>
        <h2 className="mb-3 text-base font-semibold">{t("reports.topProducts")}</h2>
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="text-xs text-foreground-muted"><tr><th className="py-2 pr-3">{t("reports.colProduct")}</th><th className="py-2 pr-3 text-right">{t("reports.colQty")}</th><th className="py-2 pr-3 text-right">{t("reports.colNetSales")}</th><th className="py-2 pr-3 text-right">{t("reports.colProfit")}</th><th className="py-2 text-right">{t("reports.colMargin")}</th></tr></thead>
          <tbody className="divide-y divide-border">
            {(data?.topProducts ?? []).map((p, i) => (
              <tr key={`${p.name}-${i}`}><td className="py-2 pr-3 font-medium">{p.name}</td><td className="tabular py-2 pr-3 text-right">{p.qty}</td><td className="tabular py-2 pr-3 text-right">{money(p.net)}</td><td className="tabular py-2 pr-3 text-right">{money(p.profit)}</td><td className="py-2 text-right"><Badge tone={p.marginPct >= 20 ? "good" : p.marginPct >= 10 ? "warn" : "bad"}>{p.marginPct}%</Badge></td></tr>
            ))}
          </tbody>
        </table>
        {data && data.topProducts.length === 0 && <p className="py-6 text-center text-sm text-foreground-muted">{t("reports.noSales")}</p>}
      </section>

      <section className="rise card-surface p-5" style={{ "--i": 9 } as React.CSSProperties}>
        <h2 className="mb-1 text-base font-semibold">{t("reports.taxExports")}</h2>
        <p className="mb-3 text-sm text-foreground-muted">{t("reports.taxExportsDesc")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">{t("reports.month")}
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
          </label>
          {(["b2cs", "b2b", "hsn", "docs", "cdn"] as const).map((sec) => (
            <a key={sec} href={`/api/reports/gstr1.csv?month=${month}&section=${sec}`} download>
              <Button variant="secondary" type="button"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> GSTR-1 {sec.toUpperCase()}</Button>
            </a>
          ))}
          <a href={`/api/reports/tax-summary.csv?from=${month}-01&to=${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, "0")}`} download>
            <Button variant="secondary" type="button"><Download className="h-4 w-4" aria-hidden="true" /> {t("reports.taxSummary")}</Button>
          </a>
        </div>
      </section>
    </div>
  );
}
