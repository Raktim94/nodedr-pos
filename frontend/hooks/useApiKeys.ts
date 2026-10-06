"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiKey, ApiKeyWithSecrets } from "@/lib/types";

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api.get<ApiKey[]>("/api-keys"),
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; canWrite?: boolean; scopes?: string[]; webhookUrl?: string; confirmPassword: string }) =>
      api.post<ApiKeyWithSecrets>("/api-keys", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useUpdateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      confirmPassword,
      ...patch
    }: {
      id: number;
      confirmPassword: string;
      name?: string;
      canWrite?: boolean;
      scopes?: string[];
      webhookUrl?: string;
      revoked?: boolean;
    }) => api.put<ApiKeyWithSecrets>(`/api-keys/${id}`, { ...patch, confirmPassword }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmPassword }: { id: number; confirmPassword: string }) =>
      api.delete<void>(`/api-keys/${id}`, { confirmPassword }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}
