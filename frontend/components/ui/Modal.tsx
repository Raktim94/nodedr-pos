"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

// Shared overlay for dialogs and right-hand drawers: dimmed backdrop, focus
// moves in and is trapped, Escape closes, focus returns to whatever opened
// it. `variant="drawer"` slides 24px in from the right (full width on phones).
export function Modal({
  title,
  onClose,
  children,
  variant = "dialog",
  size = "md",
  closeOnBackdrop = true,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  variant?: "dialog" | "drawer";
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[autofocus],input,select,textarea") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [onClose]);

  const drawer = variant === "drawer";
  return (
    <div
      className={clsx("backdrop-in fixed inset-0 z-50 bg-[rgb(8_28_18/0.32)]", drawer ? "flex justify-end" : "flex items-center justify-center p-4")}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "flex max-h-full flex-col overflow-hidden bg-surface text-foreground",
          drawer
            ? "drawer-in h-full w-full border-l border-border shadow-[var(--shadow-float)] sm:max-w-md"
            : clsx("dialog-in w-full rounded-2xl border border-border shadow-[var(--shadow-float)]", size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-3xl" : "max-w-lg")
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted hover:bg-surface-muted hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
