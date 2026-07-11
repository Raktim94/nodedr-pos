"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ShopSettings } from "@/lib/types";

export function useShopSettings() {
  return useQuery({
    queryKey: ["shop-settings"],
    queryFn: () => api.get<ShopSettings>("/settings"),
  });
}
