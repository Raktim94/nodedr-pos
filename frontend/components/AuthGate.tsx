"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { AuthUser } from "@/lib/types";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Note: `ready` is only ever set to true, never reset to false here.
    // On the very first run it starts false (see useState above) so the
    // initial auth check shows a spinner; on later pathname changes we
    // re-verify in the background without flashing the spinner, redirecting
    // if the check turns out to require it.
    async function check() {
      try {
        const status = await api.get<{ onboarded: boolean }>("/auth/status");
        if (cancelled) return;

        if (!status.onboarded) {
          if (pathname !== "/onboarding") {
            router.replace("/onboarding");
            return;
          }
          setReady(true);
          return;
        }

        try {
          await api.get<AuthUser>("/auth/me");
          if (cancelled) return;
          if (pathname === "/login" || pathname === "/onboarding") {
            router.replace("/dashboard");
            return;
          }
          setReady(true);
        } catch {
          if (cancelled) return;
          if (pathname !== "/login") {
            router.replace("/login");
            return;
          }
          setReady(true);
        }
      } catch {
        // Backend unreachable — let the page render so it can show its own error state.
        if (!cancelled) setReady(true);
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  return <>{children}</>;
}
