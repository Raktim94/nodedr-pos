"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// NodeDR POS is offline-first: there is no cloud to sync with, so "sync
// status" here means "is the local backend on this network reachable" —
// the thing that actually determines whether a sale can be recorded right
// now. Polling is cheap (a single JSON field) and short-lived on failure
// so a dead backend is reflected within one interval, not left stale.
export function useSyncStatus() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<{ status: string }>("/health"),
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}
