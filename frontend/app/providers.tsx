"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/Toast";
import { AuthGate } from "@/components/AuthGate";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthGate>{children}</AuthGate>
      </ToastProvider>
    </QueryClientProvider>
  );
}
