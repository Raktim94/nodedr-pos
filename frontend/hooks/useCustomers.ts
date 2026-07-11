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
