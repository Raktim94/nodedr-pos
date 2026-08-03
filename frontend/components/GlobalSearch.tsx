"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ScanBarcode,
  Package,
  Users,
  ReceiptText,
  Settings,
  Search,
  CornerDownLeft,
} from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { effectivePrice } from "@/lib/quote";
import { formatMoney } from "@/lib/format";

const SHORTCUTS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pos", label: "POS Checkout", icon: ScanBarcode },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/sales", label: "Sales", icon: ReceiptText },
  { href: "/settings", label: "Settings", icon: Settings },
];

// Mount this component only while it should be visible (e.g.
// `{searchOpen && <GlobalSearch ... />}`) rather than keeping it always
// mounted and toggling an `open` prop — a fresh mount starts from a clean
// query with no reset-on-open effect needed.
export function GlobalSearch({ onClose, sym }: { onClose: () => void; sym: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setCommitted(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results } = useProducts(committed);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const shortcuts = SHORTCUTS.filter((s) => s.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel w-full max-w-xl overflow-hidden rounded-2xl bg-surface-elevated shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, or jump to a page…"
            aria-label="Global search"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
          />
          <kbd className="hidden shrink-0 rounded-md border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted sm:block">
            Esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {shortcuts.length > 0 && (
            <div className="mb-1">
              <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Go to</p>
              {shortcuts.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.href}
                    type="button"
                    onClick={() => {
                      router.push(s.href);
                      onClose();
                    }}
                    className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-brand-soft"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden="true" />
                    {s.label}
                    <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0 text-foreground-muted opacity-0 group-hover:opacity-100" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          )}

          {committed && (
            <div>
              <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Products</p>
              {!results ? (
                <p className="px-2.5 py-2 text-sm text-foreground-muted">Searching…</p>
              ) : results.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-foreground-muted">No products match &ldquo;{committed}&rdquo;.</p>
              ) : (
                results.slice(0, 8).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      router.push("/inventory");
                      onClose();
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-brand-soft"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {p.name}
                      {p.barcode && <span className="ml-1.5 font-normal text-foreground-muted">· {p.barcode}</span>}
                    </span>
                    <span className="shrink-0 text-foreground-muted">{formatMoney(effectivePrice(p), sym)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
