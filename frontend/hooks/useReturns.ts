"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RefundMethod, ReturnRecord } from "@/lib/types";

export function useReturnsForInvoice(invoiceId: number | null) {
  return useQuery({
    queryKey: ["returns", "invoice", invoiceId],
    queryFn: () => api.get<ReturnRecord[]>(`/returns/by-invoice/${invoiceId}`),
    enabled: invoiceId != null,
  });
}

export interface CreateReturnInput {
  invoiceId: number;
  items: { invoiceItemId: number; quantity: number }[];
  refundMethod: RefundMethod;
  note?: string;
}

export function useCreateReturn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReturnInput) => api.post<ReturnRecord>("/returns", data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["returns", "invoice", variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoice", variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}
