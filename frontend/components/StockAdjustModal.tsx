"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useUpdateProduct } from "@/hooks/useProducts";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import type { Product } from "@/lib/types";

// Fast counter-side restock: add/remove units without opening the full
// product form. Useful when a delivery comes in or a shelf count is off.
export function StockAdjustModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const updateProduct = useUpdateProduct();
  const { show } = useToast();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const delta = (Number(amount) || 0) * (mode === "add" ? 1 : -1);
  const resultStock = Math.max(0, product.stock + delta);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      show("Enter a quantity greater than 0", "error");
      return;
    }
    try {
      await updateProduct.mutateAsync({ id: product.id, data: { stock: resultStock } });
      show(`Stock updated: ${product.name} → ${resultStock}`, "success");
      onClose();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not update stock", "error");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="stock-modal-title" className="text-lg font-semibold text-foreground">
            Adjust Stock
          </h2>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="text-foreground/40 hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p className="mb-4 text-sm text-foreground/70">
          {product.name} <span className="text-foreground/40">· currently {product.stock} in stock</span>
        </p>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("add")}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "add" ? "border-brand bg-brand text-brand-foreground" : "border-border text-foreground/70 hover:bg-surface-muted"
              }`}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add stock
            </button>
            <button
              type="button"
              onClick={() => setMode("remove")}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "remove" ? "border-danger bg-danger text-white" : "border-border text-foreground/70 hover:bg-surface-muted"
              }`}
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
              Remove stock
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="stock-amount" className="text-sm font-medium text-foreground">
              Quantity to {mode === "add" ? "add" : "remove"}
            </label>
            <input
              id="stock-amount"
              type="number"
              min={1}
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-foreground/70">
            New stock will be <span className="font-semibold text-foreground">{resultStock}</span>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateProduct.isPending}>
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
