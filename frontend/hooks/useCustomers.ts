"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Customer } from "@/lib/types";

export function useCustomers(search = "") {
  return useQuery({
    queryKey: ["customers", search],
    queryFn: () => api.get<Customer[]>(`/customers${search ? `?q=${encodeURIComponent(search)}` : ""}`),
  });
}

export function useTopLoyaltyCustomers(limit = 5) {
  return useQuery({
    queryKey: ["customers", "top-loyalty", limit],
    queryFn: () => api.get<Customer[]>(`/customers/top-loyalty?limit=${limit}`),
  });
}

export interface CustomerInput {
  name: string;
  phone: string;
  email?: string;
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CustomerInput) => api.post<Customer>("/customers", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useSettleDue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, note }: { id: number; amount: number; note?: string }) =>
      api.post<Customer>(`/customers/${id}/settle-due`, { amount, note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}
