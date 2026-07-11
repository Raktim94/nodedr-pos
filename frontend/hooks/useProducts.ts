"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Product } from "@/lib/types";

export interface ProductInput {
  barcode: string;
  name: string;
  category?: string;
  hsn?: string;
  purchasePrice: number;
  sellingPrice: number;
  taxRate: number;
  stock: number;
}

export function useProducts(search = "") {
  return useQuery({
    queryKey: ["products", search],
    queryFn: () => api.get<Product[]>(`/products${search ? `?q=${encodeURIComponent(search)}` : ""}`),
  });
}

export function useLowStock() {
  return useQuery({
    queryKey: ["products", "low-stock"],
    queryFn: () => api.get<{ threshold: number; products: Product[] }>("/products/low-stock"),
    refetchInterval: 30_000,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProductInput) => api.post<Product>("/products", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ProductInput> }) =>
      api.put<Product>(`/products/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/products/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}
