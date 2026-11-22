"use client";

import { useRef, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTranslation } from "@/components/I18nProvider";
import { api, ApiError } from "@/lib/api";
import { usePoller } from "@/hooks/usePoller";

// Pushes the exact amount to the shop's card reader (Stripe Terminal or
// Square) and polls until the customer has tapped/inserted. The resulting
// payment id is sent with the sale; the server re-verifies it with the
// provider before accepting it, so a tampered id cannot fake a card payment.
export function TerminalCharge({
  amount,
  reference,
  paymentId,
  onPaid,
}: {
  amount: number;
  reference: string;
  paymentId: string | null;
  onPaid: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "waiting" | "failed">("idle");
  const [error, setError] = useState("");
  const poller = usePoller();
  const current = useRef<string | null>(null);

  async function start() {
    setError("");
    setState("waiting");
    try {
      const { id } = await api.post<{ id: string }>("/payments/terminal/charge", { amount, reference });
      current.current = id;
      poller.start(async () => {
        const s = await api.get<{ status: string }>(`/payments/terminal/status/${encodeURIComponent(id)}`);
        if (s.status === "PAID") {
          poller.stop();
          setState("idle");
          onPaid(id);
        } else if (s.status === "FAILED" || s.status === "CANCELED") {
          poller.stop();
          setState("failed");
          setError(s.status === "CANCELED" ? t("terminal.cancelled") : t("terminal.declined"));
        }
      }, 2000);
    } catch (e) {
      setState("failed");
      setError(e instanceof ApiError ? e.message : t("terminal.unreachable"));
    }
  }

  async function cancel() {
    poller.stop();
    if (current.current) await api.post(`/payments/terminal/cancel/${encodeURIComponent(current.current)}`).catch(() => {});
    setState("idle");
  }

  if (paymentId) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm font-medium text-success">
        <CreditCard className="h-4 w-4" aria-hidden="true" /> {t("terminal.received")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {state === "waiting" ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-soft px-3 py-2.5 text-sm text-brand">
          <span className="flex items-center gap-2" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("terminal.waiting")}
          </span>
          <Button variant="ghost" onClick={cancel}>
            {t("terminal.cancel")}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" disabled={!(amount > 0)} onClick={start}>
          <CreditCard className="h-4 w-4" aria-hidden="true" /> {t("terminal.charge")}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
