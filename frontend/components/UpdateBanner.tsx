"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpCircle, X } from "lucide-react";
import { useUpdateStatus } from "@/hooks/useUpdate";

const DISMISS_KEY = "nodedr-update-dismissed";

// Admin-only strip shown above the page when a newer version is published.
// Dismissing hides it for that version only — the next release shows it again,
// and Settings > Updates always stays available.
export function UpdateBanner({ isAdmin }: { isAdmin: boolean }) {
  const { data } = useUpdateStatus(isAdmin);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY));
    } catch {}
  }, []);

  if (!isAdmin || !data?.updateAvailable || !data.latest || dismissed === data.latest) return null;

  function dismiss() {
    if (!data?.latest) return;
    setDismissed(data.latest);
    try {
      localStorage.setItem(DISMISS_KEY, data.latest);
    } catch {}
  }

  return (
    <div role="status" className="flex items-center gap-3 border-b border-brand/30 bg-brand-soft px-4 py-2.5 text-sm text-foreground sm:px-6">
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Update available:</span> NodeDR POS {data.latest} is ready (you have {data.current}).
      </p>
      <Link
        href="/settings?tab=Updates"
        className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-opacity hover:opacity-90"
      >
        {data.canUpdate ? "Update now" : "View"}
      </Link>
      <button type="button" onClick={dismiss} aria-label="Dismiss update notice" className="shrink-0 rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
