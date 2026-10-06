"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { api, describeApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useToast } from "@/components/Toast";
import type { Shift } from "@/lib/types";

const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

export function useShift() {
  return useQuery({ queryKey: ["shift"], queryFn: () => api.get<Shift | null>("/shifts/current"), refetchInterval: 60_000 });
}

// The dark "register timer" tile: shows the open shift's running time and
// drawer expectation, opens a shift with a float, and closes it with a counted
// total (variance shown). Starting/stopping is always an explicit click —
// nothing auto-starts.
export function ShiftTile({ sym }: { sym: string }) {
  const { data: shift } = useShift();
  const qc = useQueryClient();
  const { show } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [dialog, setDialog] = useState<"open" | "close" | "move" | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [moveType, setMoveType] = useState<"IN" | "OUT">("IN");

  useEffect(() => {
    if (!shift) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [shift]);

  const run = useMutation({
    mutationFn: async () => {
      const n = Number(amount) || 0;
      if (dialog === "open") return api.post("/shifts/open", { openingFloat: n });
      if (dialog === "move") return api.post("/shifts/movement", { type: moveType, amount: n, note });
      return api.post<{ variance: number }>("/shifts/close", { closingCounted: n, note: note || undefined });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["shift"] });
      if (dialog === "close") {
        const v = (r as { variance: number }).variance;
        show(v === 0 ? "Shift closed — drawer matches exactly" : `Shift closed — ${v > 0 ? "over" : "short"} by ${formatMoney(Math.abs(v), sym)}`, v === 0 ? "success" : "info");
      }
      setDialog(null);
      setAmount("");
      setNote("");
    },
    onError: (e) => show(describeApiError(e, "Failed"), "error"),
  });

  return (
    <div className="tile-dark rise rounded-2xl p-5" style={{ "--i": 3 } as React.CSSProperties}>
      <p className="text-xs font-medium text-white/70">{shift ? "Register open" : "Register closed"}</p>
      <p className="tabular my-3 text-center text-[2.6rem] font-medium leading-none tracking-[-0.04em]" aria-live="off">
        {shift ? hms(now - new Date(shift.openedAt).getTime()) : "00:00:00"}
      </p>
      {shift && (
        <p className="mb-3 text-center text-xs text-white/70">
          {shift.bills} bills · expected in drawer <span className="tabular font-semibold text-white">{formatMoney(shift.expectedCash, sym)}</span>
        </p>
      )}
      <div className="flex items-center justify-center gap-3">
        {shift ? (
          <>
            <button type="button" aria-label="Pay in / pay out" onClick={() => { setMoveType("IN"); setDialog("move"); }} className="press flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
              <Pause className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" aria-label="Close shift" onClick={() => setDialog("close")} className="press flex h-11 w-11 items-center justify-center rounded-full bg-[#cf4949] hover:opacity-90">
              <Square className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        ) : (
          <button type="button" aria-label="Open shift" onClick={() => setDialog("open")} className="press flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
            <Play className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {dialog && (
        <Modal title={dialog === "open" ? "Open register" : dialog === "close" ? "Close register" : "Cash in / out"} onClose={() => setDialog(null)} size="sm">
          <form
            className="flex flex-col gap-3 text-foreground"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate();
            }}
          >
            {dialog === "move" && (
              <div className="grid grid-cols-2 gap-2">
                {(["IN", "OUT"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setMoveType(t)} className={`rounded-lg border px-3 py-2 text-sm font-medium ${moveType === t ? "border-brand bg-brand text-brand-foreground" : "border-border"}`}>
                    Pay {t.toLowerCase()}
                  </button>
                ))}
              </div>
            )}
            <Field label={dialog === "open" ? "Opening float" : dialog === "close" ? `Counted cash (expected ${formatMoney(shift?.expectedCash ?? 0, sym)})` : "Amount"} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            {dialog !== "open" && <Field label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
            <Button type="submit" disabled={run.isPending || (dialog !== "open" && !amount)}>
              {run.isPending ? "Saving…" : dialog === "open" ? "Open register" : dialog === "close" ? "Close register" : "Save"}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
