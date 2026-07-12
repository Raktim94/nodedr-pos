"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface MastersSummary {
  hsn: number;
  sac: number;
  pincodes: number;
  ifsc: number;
}

export function useMastersSummary() {
  return useQuery({
    queryKey: ["masters", "summary"],
    queryFn: () => api.get<MastersSummary>("/masters/summary"),
  });
}

export function useImportTaxCodes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, file }: { type: "HSN" | "SAC"; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<{ imported: number }>(`/masters/tax-codes/import?type=${type}`, form);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["masters", "summary"] }),
  });
}

export function useImportPincodes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<{ imported: number }>("/masters/pincodes/import", form);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["masters", "summary"] }),
  });
}

export function useImportIfsc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<{ imported: number }>("/masters/ifsc/import", form);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["masters", "summary"] }),
  });
}

export interface PinCodeRecord {
  pincode: string;
  area: string | null;
  district: string | null;
  state: string | null;
}

export interface IfscRecord {
  ifsc: string;
  bank: string | null;
  branch: string | null;
  address: string | null;
  district: string | null;
  state: string | null;
}
