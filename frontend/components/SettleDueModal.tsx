"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useSettleDue } from "@/hooks/useCustomers";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { Customer } from "@/lib/types";

export function SettleDueModal({ customer, sym, onClose }: { customer: Customer; sym: string; onClose: () => void }) {
  const [amount, setAmount] = useState(String(customer.totalDue));
  const settleDue = useSettleDue();
  const { show } = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      show("Enter an amount greater than 0", "error");
      return;
    }
    try {
      await settleDue.mutateAsync({ id: customer.id, amount: n });
      show(`Payment recorded for ${customer.name}`, "success");
      onClose();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not record payment", "error");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settle-due-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="settle-due-title" className="text-lg font-semibold text-foreground">
            Record a due payment
          </h2>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="text-foreground/40 hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mb-4 text-sm text-foreground/70">
          {customer.name} currently owes <span className="font-semibold text-foreground">{formatMoney(customer.totalDue, sym)}</span>
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label="Amount received"
            type="number"
            min={0}
            max={customer.totalDue}
            step="0.01"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={settleDue.isPending}>
              Record payment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
