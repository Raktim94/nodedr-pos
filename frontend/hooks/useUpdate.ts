"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface UpdateStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  // false on installs that have no updater container (e.g. the macOS app).
  canUpdate: boolean;
  checkedAt: string;
  checkError: string | null;
  releaseUrl: string;
}

// Admin-only (the endpoint 403s for everyone else, so callers pass `enabled`).
// The backend caches the GitHub lookup for 10 minutes, so this is cheap, and a
// shop with no internet just gets `checkError` back rather than a failure.
export function useUpdateStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["update-status"],
    queryFn: () => api.get<UpdateStatus>("/update/status"),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    refetchInterval: 30 * 60_000,
    refetchOnWindowFocus: true,
  });
}
