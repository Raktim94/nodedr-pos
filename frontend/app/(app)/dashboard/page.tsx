"use client";

import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Award, CircleDollarSign, Download, Package, Receipt, Star, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Sparkline } from "@/components/ui/Sparkline";
import { SalesCharts } from "@/components/SalesCharts";
import { useLowStock, useProducts } from "@/hooks/useProducts";
import { useInvoices, useSalesAnalytics, useSalesSummary } from "@/hooks/useInvoices";
import { useDueSummary, useTopDueCustomers, useTopLoyaltyCustomers } from "@/hooks/useCustomers";
import { useShopSettings } from "@/hooks/useShopSettings";
import { formatMoney } from "@/lib/format";

export default function DashboardPage() {
  const { data: shop } = useShopSettings();
  const { data: products } = useProducts();
  const { data: lowStock } = useLowStock();
  const { data: summary } = useSalesSummary();
  const { data: invoices } = useInvoices();
  const { data: analytics } = useSalesAnalytics();
  const { data: topCustomers } = useTopLoyaltyCustomers(10);
  const { data: dueSummary } = useDueSummary();
  const { data: topDueCustomers } = useTopDueCustomers(8);

  const sym = shop?.currencySymbol || "Rs.";
  const money = (n: number) => formatMoney(n, sym);
  const bestSeller = analytics?.topProducts[0];

  // trend is ordered oldest → newest over the last 14 days, so the final
  // two entries are today and yesterday — enough to show a "vs yesterday"
  // delta without a dedicated backend endpoint.
  const trend = analytics?.trend ?? [];
  const today = trend.at(-1);
  const yesterday = trend.at(-2);
  const pctDelta = (curr?: number, prev?: number) => {
    if (curr == null || prev == null || prev === 0) return null;
    return ((curr - prev) / prev) * 100;
  };
  const revenueDelta = pctDelta(today?.revenue, yesterday?.revenue);
  const salesDelta = pctDelta(today?.count, yesterday?.count);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-foreground/60">Overview of your shop.</p>
        </div>
        <a href="/api/invoices/export.csv" download>
          <Button type="button" variant="secondary">
            <Download className="h-4 w-4" aria-hidden="true" />
            Export sales CSV
          </Button>
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={Receipt}
          label="Today's Sales"
          value={`${summary?.todaysCount ?? 0}`}
          delta={salesDelta}
          sparkline={trend.map((t) => t.count)}
        />
        <StatCard
          icon={TrendingUp}
          label="Today's Revenue"
          value={money(summary?.todaysRevenue ?? 0)}
          delta={revenueDelta}
          sparkline={trend.map((t) => t.revenue)}
        />
        <StatCard icon={Package} label="Total Products" value={`${products?.length ?? 0}`} />
        <StatCard
          icon={AlertTriangle}
          label="Low Stock Items"
          value={`${lowStock?.products.length ?? 0}`}
          accent={lowStock?.products.length ? "warning" : undefined}
        />
        <StatCard
          icon={CircleDollarSign}
          label="Total Due"
          value={money(dueSummary?.totalDue ?? 0)}
          accent={dueSummary?.totalDue ? "danger" : undefined}
        />
      </div>

      {bestSeller && bestSeller.quantity > 0 && (
        <Card className="flex items-center gap-4 border-brand/30 bg-brand/5 p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Award className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-medium text-foreground/50">Best seller (last 14 days)</p>
            <p className="text-base font-semibold text-foreground">
              {bestSeller.name} <span className="font-normal text-foreground/60">· {bestSeller.quantity} sold · {money(bestSeller.revenue)}</span>
            </p>
          </div>
        </Card>
      )}

      <SalesCharts sym={sym} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Low Inventory Alerts</h2>
            <Link href="/inventory" className="text-sm font-medium text-brand hover:underline">
              Manage inventory
            </Link>
          </div>
          {!lowStock || lowStock.products.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground/50">
              All products are above the low-stock threshold ({lowStock?.threshold ?? 5}).
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {lowStock.products.map((product) => (
                <li key={product.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{product.name}</p>
                    <p className="text-xs text-foreground/50">Barcode: {product.barcode}</p>
                  </div>
                  <span className="rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
                    {product.stock} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Top Customers</h2>
            <Link href="/customers" className="text-sm font-medium text-brand hover:underline">
              View all
            </Link>
          </div>
          {!topCustomers || topCustomers.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground/50">
              No loyalty points earned yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {topCustomers.map((customer, i) => (
                <li key={customer.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-foreground/60">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{customer.name}</p>
                      <p className="text-xs text-foreground/50">{customer.phone}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
                    <Star className="h-3 w-3" aria-hidden="true" />
                    {customer.loyaltyPoints}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Customers with Due</h2>
            <Link href="/customers" className="text-sm font-medium text-brand hover:underline">
              View all
            </Link>
          </div>
          {!topDueCustomers || topDueCustomers.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground/50">No outstanding dues right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {topDueCustomers.map((customer) => (
                <li key={customer.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{customer.name}</p>
                    <p className="text-xs text-foreground/50">{customer.phone}</p>
                  </div>
                  <span className="rounded-full bg-danger-soft px-3 py-1 text-xs font-semibold text-danger">
                    {money(customer.totalDue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Recent Invoices</h2>
          <Link href="/sales" className="text-sm font-medium text-brand hover:underline">
            View all
          </Link>
        </div>
        {!invoices || invoices.length === 0 ? (
          <p className="py-6 text-center text-sm text-foreground/50">No sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-foreground/50">
                  <th className="py-2 pr-4">Invoice #</th>
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoices.slice(0, 8).map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-2.5 pr-4 font-medium text-foreground">{inv.invoiceNumber}</td>
                    <td className="py-2.5 pr-4 text-foreground/70">{inv.customerName}</td>
                    <td className="py-2.5 pr-4 text-foreground/70">{new Date(inv.createdAt).toLocaleString()}</td>
                    <td className="py-2.5 text-right font-medium text-foreground">{money(inv.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  delta,
  sparkline,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: "warning" | "danger";
  /** Percentage change vs. yesterday. Omit when there's no meaningful "yesterday" to compare (e.g. a point-in-time count). */
  delta?: number | null;
  sparkline?: number[];
}) {
  const hasTrend = delta != null && !Number.isNaN(delta);
  const positive = hasTrend && delta! >= 0;

  return (
    <Card className="group relative overflow-hidden p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-lg">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                accent === "warning"
                  ? "bg-warning-soft text-warning"
                  : accent === "danger"
                    ? "bg-danger-soft text-danger"
                    : "bg-brand-soft text-brand icon-glow"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <p className="text-xs font-medium text-foreground-muted">{label}</p>
          </div>
          <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
          {hasTrend && (
            <p
              className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${
                positive ? "text-success" : "text-danger"
              }`}
            >
              {positive ? (
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {Math.abs(delta!).toFixed(1)}%
              <span className="font-normal text-foreground-muted">vs yesterday</span>
            </p>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <Sparkline data={sparkline} color={positive || !hasTrend ? "var(--brand)" : "var(--danger)"} />
        )}
      </div>
    </Card>
  );
}
