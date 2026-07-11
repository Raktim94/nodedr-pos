"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AuthUser, Role } from "@/lib/types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<AuthUser>("/auth/me"),
    retry: false,
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<AuthUser[]>("/auth/users"),
  });
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserInput) => api.post<AuthUser>("/auth/users", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateUserInput> & { active?: boolean } }) =>
      api.put<AuthUser>(`/auth/users/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
