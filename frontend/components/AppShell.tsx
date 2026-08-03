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
  const { data: lowStock } = useLowStock();
  const { data: health } = useSyncStatus();
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

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || me?.role === "admin");
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
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border-subtle bg-surface transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0",
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
                  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-brand-soft text-foreground before:absolute before:-left-3 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-brand before:shadow-[0_0_8px_var(--brand-glow)]"
                    : "text-foreground-muted hover:translate-x-0.5 hover:bg-surface-muted hover:text-foreground"
                )}
              >
                <Icon className={clsx("h-[18px] w-[18px]", active && "text-brand icon-glow")} aria-hidden="true" />
                {item.label}
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
            <span className="hidden items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-foreground-muted xl:flex">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
              Last 14 Days
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

        <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6 lg:p-8">{children}</main>
      </div>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} sym={sym} />}
    </div>
  );
}
