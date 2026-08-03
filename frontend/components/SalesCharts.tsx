"use client";

import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { Card } from "@/components/ui/Card";
import { useSalesAnalytics } from "@/hooks/useInvoices";
import { formatMoney } from "@/lib/format";

const PAYMENT_COLORS: Record<string, string> = {
  CASH: "var(--color-warning)",
  UPI: "var(--color-success)",
  CARD: "var(--color-brand)",
};
const FALLBACK_COLORS = ["var(--color-brand)", "var(--color-success)", "var(--color-warning)"];

function RevenueTooltip({
  active,
  payload,
  label,
  money,
}: TooltipContentProps<ValueType, NameType> & { money: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as { date: string; revenue: number; count: number };
  return (
    <div className="glass-panel rounded-xl bg-surface-elevated px-3.5 py-2.5 text-xs shadow-2xl">
      <p className="mb-1.5 font-medium text-foreground">
        {new Date(String(label)).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
      </p>
      <div className="flex items-center justify-between gap-6">
        <span className="text-foreground-muted">Total sales</span>
        <span className="font-medium text-foreground">{point.count}</span>
      </div>
      <div className="flex items-center justify-between gap-6">
        <span className="text-foreground-muted">Total revenue</span>
        <span className="font-medium text-foreground">{money(point.revenue)}</span>
      </div>
    </div>
  );
}

export function SalesCharts({ sym }: { sym: string }) {
  const { data, isLoading } = useSalesAnalytics();
  const money = (n: number) => formatMoney(n, sym);

  const hasTrend = data?.trend.some((d) => d.revenue > 0 || d.count > 0);
  const hasProducts = data && data.topProducts.length > 0;
  const hasPayments = data && data.paymentMethods.length > 0;
  const paymentTotal = data?.paymentMethods.reduce((s, m) => s + m.revenue, 0) ?? 0;
  const maxQuantity = data ? Math.max(...data.topProducts.map((p) => p.quantity), 1) : 1;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h2 className="mb-4 text-base font-semibold text-foreground">Revenue — last 14 days</h2>
        {isLoading ? (
          <p className="py-16 text-center text-sm text-foreground-muted">Loading…</p>
        ) : !hasTrend ? (
          <p className="py-16 text-center text-sm text-foreground-muted">Not enough sales yet to chart a trend.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data!.trend} margin={{ left: -12, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-border-subtle)" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                tick={{ fontSize: 11, fill: "var(--color-foreground-muted)" }}
                axisLine={{ stroke: "var(--color-border-subtle)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-foreground-muted)" }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
                content={(props) => <RevenueTooltip {...props} money={money} />}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="var(--color-brand)"
                strokeWidth={2}
                fill="url(#revenueFill)"
                dot={false}
                activeDot={{ r: 5, fill: "var(--color-brand)", stroke: "var(--color-surface-elevated)", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-base font-semibold text-foreground">Payment methods</h2>
        {isLoading ? (
          <p className="py-16 text-center text-sm text-foreground-muted">Loading…</p>
        ) : !hasPayments ? (
          <p className="py-16 text-center text-sm text-foreground-muted">No sales recorded yet.</p>
        ) : (
          <div>
            <div className="relative mx-auto h-[180px] w-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data!.paymentMethods}
                    dataKey="revenue"
                    nameKey="method"
                    innerRadius={62}
                    outerRadius={88}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {data!.paymentMethods.map((entry, i) => (
                      <Cell key={entry.method} fill={PAYMENT_COLORS[entry.method] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => money(Number(value))}
                    contentStyle={{
                      background: "var(--color-surface-elevated)",
                      border: "1px solid var(--color-border-subtle)",
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-[11px] text-foreground-muted">Total</p>
                <p className="text-base font-bold text-foreground">{money(paymentTotal)}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {data!.paymentMethods.map((m, i) => {
                const pct = paymentTotal > 0 ? (m.revenue / paymentTotal) * 100 : 0;
                return (
                  <div key={m.method} className="flex items-center gap-3 text-sm">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: PAYMENT_COLORS[m.method] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium capitalize text-foreground">{m.method.toLowerCase()}</span>
                    <span className="shrink-0 text-foreground-muted">{m.count}×</span>
                    <span className="w-11 shrink-0 text-right text-foreground-muted">{pct.toFixed(0)}%</span>
                    <span className="w-20 shrink-0 text-right font-medium text-foreground">{money(m.revenue)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 lg:col-span-3">
        <h2 className="mb-4 text-base font-semibold text-foreground">Top selling products</h2>
        {isLoading ? (
          <p className="py-16 text-center text-sm text-foreground-muted">Loading…</p>
        ) : !hasProducts ? (
          <p className="py-16 text-center text-sm text-foreground-muted">No sales recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {data!.topProducts.map((p, i) => (
              <div
                key={p.name}
                className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-muted sm:flex-nowrap"
              >
                <span className="order-1 w-4 shrink-0 text-xs font-medium text-foreground-muted sm:order-1">{i + 1}</span>
                <span className="order-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand sm:order-2">
                  {p.name.trim().slice(0, 1).toUpperCase()}
                </span>
                <span className="order-3 min-w-0 flex-1 truncate text-sm font-medium text-foreground sm:order-3 sm:w-48 sm:flex-none">
                  {p.name}
                </span>
                <span className="order-4 shrink-0 text-right text-sm text-foreground-muted sm:order-5 sm:w-20">{p.quantity} sold</span>
                <span className="order-5 shrink-0 text-right text-sm font-semibold text-foreground sm:order-6 sm:w-24">
                  {money(p.revenue)}
                </span>
                <div className="order-6 h-1.5 w-full shrink-0 overflow-hidden rounded-full bg-surface-muted sm:order-4 sm:w-auto sm:flex-1">
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-500"
                    style={{ width: `${Math.max(4, (p.quantity / maxQuantity) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
