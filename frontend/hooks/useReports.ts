"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Totals { bills: number; revenue: number; tax: number; returns: number; discounts: number; netSales: number; cost: number; grossProfit: number; marginPct: number; avgBill: number }
export interface Row { name?: string; category?: string; qty: number; net: number; cost: number; profit: number; marginPct: number }
export interface Overview {
  range: { from: string; to: string };
  totals: Totals;
  previous: Totals;
  deltas: { revenue: number; grossProfit: number; bills: number; avgBill: number };
  daily: { date: string; revenue: number; bills: number }[];
  heatmap: { bills: number; revenue: number }[][];
  categories: Row[];
  topProducts: Row[];
}
export interface Compare { period: string; current: Totals; previous: Totals; deltas: { revenue: number; grossProfit: number; bills: number } }

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function useOverview(days: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const f = dayKey(from);
  const t = dayKey(to);
  return useQuery({ queryKey: ["report", "overview", f, t], queryFn: () => api.get<Overview>(`/reports/overview?from=${f}&to=${t}`), staleTime: 30_000 });
}

export function useCompare(period: "day" | "week" | "month") {
  return useQuery({ queryKey: ["report", "compare", period], queryFn: () => api.get<Compare>(`/reports/compare?period=${period}`), staleTime: 30_000 });
}
