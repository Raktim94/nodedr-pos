"use client";

import { X } from "lucide-react";
import { BarcodeDownloadPanel } from "@/components/BarcodeDownloadPanel";
import type { Product } from "@/lib/types";

export function BarcodeLabelModal({ product, onClose }: { product: Product; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="barcode-modal-title" className="text-lg font-semibold text-foreground">
            Barcode label
          </h2>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="text-foreground/40 hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p className="mb-4 text-sm text-foreground/70">{product.name}</p>

        <BarcodeDownloadPanel value={product.barcode} />
      </div>
    </div>
  );
}
