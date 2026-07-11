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

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ShopSettings>) => api.put<ShopSettings>("/settings", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shop-settings"] }),
  });
}
