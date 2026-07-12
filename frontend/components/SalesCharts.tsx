"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { useSalesAnalytics } from "@/hooks/useInvoices";
import { formatMoney } from "@/lib/format";

const PIE_COLORS = ["var(--color-brand)", "var(--color-warning)", "var(--color-success)"];

export function SalesCharts({ sym }: { sym: string }) {
  const { data, isLoading } = useSalesAnalytics();
  const money = (n: number) => formatMoney(n, sym);

  const hasTrend = data?.trend.some((d) => d.revenue > 0 || d.count > 0);
  const hasProducts = data && data.topProducts.length > 0;
  const hasPayments = data && data.paymentMethods.length > 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h2 className="mb-4 text-base font-semibold text-foreground">Revenue — last 14 days</h2>
        {isLoading ? (
          <p className="py-16 text-center text-sm text-foreground/50">Loading…</p>
        ) : !hasTrend ? (
          <p className="py-16 text-center text-sm text-foreground/50">Not enough sales yet to chart a trend.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data!.trend} margin={{ left: -12, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.6 }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.6 }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                formatter={(value) => money(Number(value))}
                labelFormatter={(d) => new Date(String(d)).toLocaleDateString()}
                contentStyle={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area type="monotone" dataKey="revenue" stroke="var(--color-brand)" strokeWidth={2} fill="url(#revenueFill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-base font-semibold text-foreground">Payment methods</h2>
        {isLoading ? (
          <p className="py-16 text-center text-sm text-foreground/50">Loading…</p>
        ) : !hasPayments ? (
          <p className="py-16 text-center text-sm text-foreground/50">No sales recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={data!.paymentMethods}
                dataKey="revenue"
                nameKey="method"
                innerRadius={50}
                outerRadius={85}
                paddingAngle={3}
              >
                {data!.paymentMethods.map((entry, i) => (
                  <Cell key={entry.method} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => money(Number(value))}
                contentStyle={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-5 lg:col-span-3">
        <h2 className="mb-4 text-base font-semibold text-foreground">Top selling products</h2>
        {isLoading ? (
          <p className="py-16 text-center text-sm text-foreground/50">Loading…</p>
        ) : !hasProducts ? (
          <p className="py-16 text-center text-sm text-foreground/50">No sales recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data!.topProducts} margin={{ left: -12, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.6 }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-foreground)", opacity: 0.6 }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                formatter={(value) => `${value} sold`}
                contentStyle={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="quantity" fill="var(--color-brand)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}
