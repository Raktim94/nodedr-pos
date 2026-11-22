"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/Toast";
import { AuthGate } from "@/components/AuthGate";
import { ThemeProvider } from "@/components/ThemeProvider";
import { PasswordConfirmProvider } from "@/components/PasswordConfirm";
import { I18nProvider } from "@/components/I18nProvider";
import type { Language } from "@/lib/i18n";

export function Providers({ children, initialLanguage }: { children: React.ReactNode; initialLanguage: Language }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));

  return (
    <I18nProvider initialLanguage={initialLanguage}>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <PasswordConfirmProvider>
              <AuthGate>{children}</AuthGate>
            </PasswordConfirmProvider>
          </ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
