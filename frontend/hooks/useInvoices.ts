"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Invoice } from "@/lib/types";

export interface SalesSummary {
  todaysCount: number;
  todaysRevenue: number;
  totalSales: number;
  totalRevenue: number;
}

export interface SalesAnalytics {
  trend: { date: string; revenue: number; count: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  paymentMethods: { method: string; count: number; revenue: number }[];
}

export function useInvoices(search = "") {
  return useQuery({
    queryKey: ["invoices", search],
    queryFn: () => api.get<Invoice[]>(`/invoices${search ? `?q=${encodeURIComponent(search)}` : ""}`),
  });
}

export function useSalesSummary() {
  return useQuery({
    queryKey: ["invoices", "summary"],
    queryFn: () => api.get<SalesSummary>("/invoices/summary"),
    refetchInterval: 30_000,
  });
}

export function useInvoice(id: number | null) {
  return useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api.get<Invoice>(`/invoices/${id}`),
    enabled: id != null,
  });
}

export function useSalesAnalytics() {
  return useQuery({
    queryKey: ["invoices", "analytics"],
    queryFn: () => api.get<SalesAnalytics>("/invoices/analytics"),
    refetchInterval: 60_000,
  });
}
