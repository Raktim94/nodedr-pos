"use client";

import { useState } from "react";
import Image from "next/image";
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
  Menu,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { api } from "@/lib/api";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useMe } from "@/hooks/useAuth";
import { BrandFooter } from "@/components/BrandFooter";

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
  const [navOpen, setNavOpen] = useState(false);

  async function handleLogout() {
    await api.post("/auth/logout");
    router.replace("/login");
  }

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || me?.role === "admin");

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:flex-row">
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-full" aria-hidden="true" />
          <span className="truncate font-semibold text-foreground">{shop?.shopName || "nodedr-pos"}</span>
        </div>
        <button
          type="button"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          onClick={() => setNavOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground/70 hover:bg-surface-muted"
        >
          {navOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </header>

      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-surface transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-5">
          <Image src="/logo.png" alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full" aria-hidden="true" />
          <span className="truncate font-semibold text-foreground">{shop?.shopName || "nodedr-pos"}</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setNavOpen(false)}
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
          <BrandFooter className="mt-3" />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
