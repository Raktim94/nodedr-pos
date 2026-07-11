"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ScanBarcode,
  Package,
  Users,
  ReceiptText,
  Settings,
  LogOut,
  Store,
} from "lucide-react";
import { clsx } from "clsx";
import { api } from "@/lib/api";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useMe } from "@/hooks/useAuth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pos", label: "POS Checkout", icon: ScanBarcode },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/sales", label: "Sales", icon: ReceiptText },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: shop } = useShopSettings();
  const { data: me } = useMe();

  async function handleLogout() {
    await api.post("/auth/logout");
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="flex w-64 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-5 py-5">
          <Store className="h-6 w-6 text-brand" aria-hidden="true" />
          <span className="truncate font-semibold text-foreground">{shop?.shopName || "nodedr-pos"}</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.filter((item) => !item.adminOnly || me?.role === "admin").map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-brand text-brand-foreground" : "text-foreground/80 hover:bg-surface-muted"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          {me && (
            <div className="mb-2 px-3 py-1.5">
              <p className="truncate text-sm font-medium text-foreground">{me.name}</p>
              <p className="text-xs capitalize text-foreground/50">{me.role}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-surface-muted"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-background p-6 lg:p-8">{children}</main>
    </div>
  );
}
