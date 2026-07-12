"use client";

import { useState } from "react";
import { Download, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BarcodeCanvas } from "@/components/BarcodeCanvas";
import type { Product } from "@/lib/types";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function BarcodeLabelModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const [format, setFormat] = useState<"EAN13" | "QR">("EAN13");
  const [imageType, setImageType] = useState<"png" | "jpg">("png");

  function getCanvas() {
    return document.getElementById("barcode-label-canvas") as HTMLCanvasElement | null;
  }

  function download() {
    const canvas = getCanvas();
    if (!canvas) return;
    const link = document.createElement("a");
    if (imageType === "jpg") {
      // Canvases are transparent by default and JPEG has no alpha channel,
      // so flatten onto a white background first or the "transparent"
      // areas render black in most viewers.
      const flat = document.createElement("canvas");
      flat.width = canvas.width;
      flat.height = canvas.height;
      const ctx = flat.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      link.download = `${product.barcode}.jpg`;
      link.href = flat.toDataURL("image/jpeg", 0.95);
    } else {
      link.download = `${product.barcode}.png`;
      link.href = canvas.toDataURL("image/png");
    }
    link.click();
  }

  // Opens a self-printing tab (same pattern as receipts): the browser's own
  // print dialog handles the printer, so any label/thermal printer the OS
  // knows about works without a bundled driver.
  function print() {
    const canvas = getCanvas();
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) return;
    win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(product.name)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; text-align: center; padding: 24px; }
  img { max-width: 260px; }
  p { margin: 4px 0; font-size: 13px; }
</style>
</head>
<body onload="window.print()">
  <p><strong>${escapeHtml(product.name)}</strong></p>
  <img src="${dataUrl}" alt="${escapeHtml(product.barcode)}">
</body>
</html>`);
    win.document.close();
  }

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

        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setFormat("EAN13")}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              format === "EAN13" ? "border-brand bg-brand text-brand-foreground" : "border-border text-foreground/70 hover:bg-surface-muted"
            }`}
          >
            Barcode
          </button>
          <button
            type="button"
            onClick={() => setFormat("QR")}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              format === "QR" ? "border-brand bg-brand text-brand-foreground" : "border-border text-foreground/70 hover:bg-surface-muted"
            }`}
          >
            QR code
          </button>
        </div>

        <div className="flex justify-center rounded-lg border border-border bg-white p-4">
          <BarcodeCanvas value={product.barcode} format={format} />
        </div>

        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <span className="text-foreground/60">Download as</span>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="image-type" checked={imageType === "png"} onChange={() => setImageType("png")} />
            PNG
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="image-type" checked={imageType === "jpg"} onChange={() => setImageType("jpg")} />
            JPG
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={download}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download {imageType.toUpperCase()}
          </Button>
          <Button type="button" variant="secondary" onClick={print}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print label
          </Button>
        </div>
      </div>
    </div>
  );
}
