"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { ApiError } from "@/lib/api";

interface PendingConfirm {
  actionLabel: string;
  onSubmit: (password: string) => Promise<unknown>;
  resolve: (value: unknown) => void;
}

interface PasswordConfirmContextValue {
  // Opens a "confirm your password" prompt describing `actionLabel` (e.g.
  // "process this refund"). Calls `onSubmit` with the entered password only
  // once the shopkeeper submits; if it throws (wrong password, or any other
  // failure of the underlying action), the error shows inline and the
  // prompt stays open for another try. Resolves with onSubmit's return
  // value on success, or `undefined` if they cancel.
  withPasswordConfirm: <T,>(actionLabel: string, onSubmit: (password: string) => Promise<T>) => Promise<T | undefined>;
}

const PasswordConfirmContext = createContext<PasswordConfirmContextValue | null>(null);

export function PasswordConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const withPasswordConfirm = useCallback(
    <T,>(actionLabel: string, onSubmit: (password: string) => Promise<T>) =>
      new Promise<T | undefined>((resolve) => {
        setPassword("");
        setError(null);
        setPending({ actionLabel, onSubmit, resolve: resolve as (value: unknown) => void });
      }),
    []
  );

  function cancel() {
    pending?.resolve(undefined);
    setPending(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pending || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await pending.onSubmit(password);
      pending.resolve(result);
      setPending(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PasswordConfirmContext.Provider value={{ withPasswordConfirm }}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-confirm-title"
        >
          <Card className="w-full max-w-sm p-6">
            <h2 id="password-confirm-title" className="text-base font-semibold text-foreground">
              Confirm your password
            </h2>
            <p className="mt-1 text-sm text-foreground/60">Re-enter your password to {pending.actionLabel}.</p>
            <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
              <Field
                label="Password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error ?? undefined}
              />
              <div className="mt-1 flex gap-3">
                <Button type="button" variant="secondary" className="flex-1" onClick={cancel} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={submitting || !password}>
                  {submitting ? "Confirming…" : "Confirm"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </PasswordConfirmContext.Provider>
  );
}

export function usePasswordConfirm() {
  const ctx = useContext(PasswordConfirmContext);
  if (!ctx) throw new Error("usePasswordConfirm must be used within a PasswordConfirmProvider");
  return ctx;
}
