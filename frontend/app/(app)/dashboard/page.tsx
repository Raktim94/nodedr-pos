"use client";

import Link from "next/link";
import { AlertTriangle, Package, Receipt, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useLowStock, useProducts } from "@/hooks/useProducts";
import { useInvoices } from "@/hooks/useInvoices";
import { useShopSettings } from "@/hooks/useShopSettings";

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  );
}

export default function DashboardPage() {
  const { data: shop } = useShopSettings();
  const { data: products } = useProducts();
  const { data: lowStock } = useLowStock();
  const { data: invoices } = useInvoices();

  const todaysInvoices = invoices?.filter((inv) => isToday(inv.createdAt)) ?? [];
  const todaysRevenue = todaysInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const currency = shop?.currency || "Rs.";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-foreground/60">Overview of today&apos;s activity.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Receipt} label="Today's Sales" value={`${todaysInvoices.length}`} />
        <StatCard icon={TrendingUp} label="Today's Revenue" value={`${currency} ${todaysRevenue.toFixed(2)}`} />
        <StatCard icon={Package} label="Total Products" value={`${products?.length ?? 0}`} />
        <StatCard
          icon={AlertTriangle}
          label="Low Stock Items"
          value={`${lowStock?.products.length ?? 0}`}
          accent={lowStock?.products.length ? "warning" : undefined}
        />
      </div>

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
        <h2 className="mb-4 text-base font-semibold text-foreground">Recent Invoices</h2>
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
                    <td className="py-2.5 pr-4 text-foreground/70">
                      {new Date(inv.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 text-right font-medium text-foreground">
                      {currency} {inv.totalAmount.toFixed(2)}
                    </td>
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
