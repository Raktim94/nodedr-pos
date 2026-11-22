"use client";

import { X } from "lucide-react";
import { BarcodeDownloadPanel } from "@/components/BarcodeDownloadPanel";
import { useTranslation } from "@/components/I18nProvider";
import type { Product } from "@/lib/types";

export function BarcodeLabelModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-modal-title"
        className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="barcode-modal-title" className="text-lg font-semibold text-foreground">
            {t("barcodeLabel.title")}
          </h2>
          <button type="button" aria-label={t("common.closeDialog")} onClick={onClose} className="text-foreground/40 hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p className="mb-4 text-sm text-foreground/70">{product.name}</p>

        <BarcodeDownloadPanel value={product.barcode} />
      </div>
    </div>
  );
}
