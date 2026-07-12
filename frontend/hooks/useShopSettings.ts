"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ShopSettings } from "@/lib/types";

export function useShopSettings() {
  return useQuery({
    queryKey: ["shop-settings"],
    queryFn: () => api.get<ShopSettings>("/settings"),
  });
}

export interface CurrencyInfo {
  symbol: string;
  label: string;
}

// Currencies are defined once on the backend (backend/src/lib/currency.js)
// so the code/symbol/label mapping can't drift between onboarding and
// settings; this just fetches that list. Unauthenticated on purpose — the
// onboarding flow needs it before an admin account exists.
export function useCurrencies() {
  return useQuery({
    queryKey: ["currencies"],
    queryFn: () => api.get<Record<string, CurrencyInfo>>("/settings/currencies"),
    staleTime: Infinity,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ShopSettings>) => api.put<ShopSettings>("/settings", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shop-settings"] }),
  });
}
