"use client";

import Link from "next/link";
import { AlertTriangle, Award, Download, Package, Receipt, Star, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SalesCharts } from "@/components/SalesCharts";
import { useLowStock, useProducts } from "@/hooks/useProducts";
import { useInvoices, useSalesAnalytics, useSalesSummary } from "@/hooks/useInvoices";
import { useTopLoyaltyCustomers } from "@/hooks/useCustomers";
import { useShopSettings } from "@/hooks/useShopSettings";
import { formatMoney } from "@/lib/format";

export default function DashboardPage() {
  const { data: shop } = useShopSettings();
  const { data: products } = useProducts();
  const { data: lowStock } = useLowStock();
  const { data: summary } = useSalesSummary();
  const { data: invoices } = useInvoices();
  const { data: analytics } = useSalesAnalytics();
  const { data: topCustomers } = useTopLoyaltyCustomers(5);

  const sym = shop?.currencySymbol || "Rs.";
  const money = (n: number) => formatMoney(n, sym);
  const bestSeller = analytics?.topProducts[0];

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Receipt} label="Today's Sales" value={`${summary?.todaysCount ?? 0}`} />
        <StatCard icon={TrendingUp} label="Today's Revenue" value={money(summary?.todaysRevenue ?? 0)} />
        <StatCard icon={Package} label="Total Products" value={`${products?.length ?? 0}`} />
        <StatCard
          icon={AlertTriangle}
          label="Low Stock Items"
          value={`${lowStock?.products.length ?? 0}`}
          accent={lowStock?.products.length ? "warning" : undefined}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: "warning";
}) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
          accent === "warning" ? "bg-warning/10 text-warning" : "bg-brand/10 text-brand"
        }`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-xs font-medium text-foreground/50">{label}</p>
        <p className="text-xl font-semibold text-foreground">{value}</p>
      </div>
    </Card>
  );
}
