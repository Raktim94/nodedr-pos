"use client";

import { useEffect, useRef, useState } from "react";
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
  Search,
  Bell,
  ChevronDown,
  Cloud,
  CloudOff,
  CalendarRange,
  ShoppingBag,
  BarChart3,
  Truck,
  ShieldCheck,
  UserCog,
  Network,
  MoreHorizontal,
} from "lucide-react";
import { clsx } from "clsx";
import { api } from "@/lib/api";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useMe } from "@/hooks/useAuth";
import { useLowStock } from "@/hooks/useProducts";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { BrandFooter } from "@/components/BrandFooter";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UpdateBanner } from "@/components/UpdateBanner";
import { useUpdateStatus } from "@/hooks/useUpdate";
import { can } from "@/lib/perm";
import type { Permission } from "@/lib/types";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean; perm?: Permission; hubOnly?: boolean; staffOnly?: boolean; primary?: boolean; serialOnly?: boolean };

// staffOnly = hidden from read-only franchisor accounts (they get Reports +
// Branches only). perm = needs that granular right (admins always pass).
const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, staffOnly: true, primary: true },
  { href: "/pos", label: "POS Checkout", icon: ScanBarcode, staffOnly: true, primary: true },
  { href: "/orders", label: "Online orders", icon: ShoppingBag, perm: "orders", primary: true },
  { href: "/inventory", label: "Inventory", icon: Package, staffOnly: true, primary: true },
  { href: "/purchasing", label: "Purchasing", icon: Truck, perm: "purchasing" },
  { href: "/customers", label: "Customers", icon: Users, staffOnly: true },
  { href: "/sales", label: "Sales", icon: ReceiptText, staffOnly: true },
  { href: "/warranty", label: "Warranty", icon: ShieldCheck, staffOnly: true, serialOnly: true },
  { href: "/reports", label: "Reports", icon: BarChart3, perm: "reports" },
  { href: "/team", label: "Team", icon: UserCog, adminOnly: true },
  { href: "/branches", label: "Branches", icon: Network, hubOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: shop } = useShopSettings();
  const { data: me } = useMe();
  const { data: lowStock } = useLowStock();
  const { data: health } = useSyncStatus();
  const { data: update } = useUpdateStatus(me?.role === "admin");
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  async function handleLogout() {
    await api.post("/auth/logout");
    router.replace("/login");
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isHub = shop?.syncRole === "hub";
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!me) return false;
    if (item.serialOnly && !shop?.serialTracking) return false;
    if (item.hubOnly) return isHub && (me.role === "admin" || me.role === "franchisor");
    if (item.adminOnly) return me.role === "admin";
    if (item.staffOnly) return me.role !== "franchisor";
    if (item.perm) return can(me, item.perm);
    return true;
  });
  const primaryItems = visibleItems.filter((i) => i.primary);
  const isOnline = health?.status === "ok";
  const sym = shop?.currencySymbol || "Rs.";

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:flex-row">
      {/* Mobile header */}
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-full" aria-hidden="true" />
          <span className="truncate font-semibold text-foreground">{shop?.shopName || "nodedr-pos"}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted hover:bg-surface-muted"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
          <ThemeToggle />
          <button
            type="button"
            aria-label={navOpen ? "Close menu" : "Open menu"}
            onClick={() => setNavOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted hover:bg-surface-muted"
          >
            {navOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </header>

      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-[232px] flex-col border-r border-border-subtle bg-surface transition-transform duration-300 ease-[var(--ease-out)] lg:static lg:z-auto lg:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-border-subtle px-5 py-5">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft">
            <Image src="/logo.png" alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-md" aria-hidden="true" />
          </span>
          <span className="truncate font-semibold tracking-tight text-foreground">{shop?.shopName || "nodedr-pos"}</span>
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
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                  active
                    ? "bg-brand text-brand-foreground shadow-sm"
                    : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
                )}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                {item.label}
                {item.href === "/settings" && update?.updateAvailable && (
                  <span className="ml-auto h-2 w-2 rounded-full bg-brand shadow-[0_0_6px_var(--brand-glow)]" aria-label="Update available" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border-subtle p-3">
          {me && (
            <div className="mb-2 px-3 py-1.5">
              <p className="truncate text-sm font-medium text-foreground">{me.name}</p>
              <p className="text-xs capitalize text-foreground-muted">{me.role}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            Log out
          </button>
          <div className="mt-3 flex items-center gap-1.5 px-3 text-[11px] text-foreground-muted">
            {isOnline ? (
              <Cloud className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            ) : (
              <CloudOff className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
            )}
            {isOnline ? "Synced with local server" : "Local server unreachable"}
          </div>
          <BrandFooter className="mt-2" />
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Utility top bar (desktop) */}
        <header className="hidden items-center gap-4 border-b border-border-subtle bg-surface/80 px-6 py-3 backdrop-blur-md lg:flex">
          <Link
            href={me?.role === "admin" ? "/settings" : "#"}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-foreground transition-colors",
              me?.role === "admin" && "hover:bg-surface-muted"
            )}
          >
            <span className="truncate">{shop?.shopName || "nodedr-pos"}</span>
            {me?.role === "admin" && <ChevronDown className="h-3.5 w-3.5 text-foreground-muted" aria-hidden="true" />}
          </Link>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex flex-1 max-w-md items-center gap-2 rounded-lg border border-border-subtle bg-surface-muted/60 px-3 py-2 text-sm text-foreground-muted transition-colors hover:border-border hover:text-foreground"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left">Search products, jump to a page…</span>
            <kbd className="rounded-md border border-border-subtle bg-surface px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="tabular hidden items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-foreground-muted xl:flex">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
              {new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
            </span>

            <Link
              href="/inventory"
              aria-label={`${lowStock?.products.length ?? 0} low-stock alerts`}
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
              {!!lowStock?.products.length && (
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_6px_var(--brand-glow)]" />
              )}
            </Link>

            <ThemeToggle />

            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-label="Account menu"
                aria-expanded={userMenuOpen}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand transition-transform hover:scale-105"
              >
                {me?.name?.trim()?.[0]?.toUpperCase() || "?"}
              </button>
              {userMenuOpen && (
                <div className="glass-panel absolute right-0 top-11 z-10 w-48 overflow-hidden rounded-xl bg-surface-elevated shadow-2xl">
                  <div className="border-b border-border-subtle px-3.5 py-3">
                    <p className="truncate text-sm font-medium text-foreground">{me?.name}</p>
                    <p className="text-xs capitalize text-foreground-muted">{me?.role}</p>
                  </div>
                  {me?.role === "admin" && (
                    <Link
                      href="/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-muted"
                    >
                      <Settings className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
                      Settings
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    <LogOut className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <UpdateBanner isAdmin={me?.role === "admin"} />

        <main className="mx-auto w-full max-w-[1440px] flex-1 overflow-y-auto bg-background p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8">{children}</main>

        {/* Compact bottom navigation on phones/tablets — 44px+ touch targets. */}
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] lg:hidden">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={clsx("flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-brand" : "text-foreground-muted")}>
                <Icon className="h-5 w-5" aria-hidden="true" />
                {item.label.replace("POS Checkout", "POS").replace("Online orders", "Orders")}
              </Link>
            );
          })}
          <button type="button" onClick={() => setNavOpen(true)} className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-foreground-muted">
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            More
          </button>
        </nav>
      </div>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} sym={sym} />}
    </div>
  );
}
