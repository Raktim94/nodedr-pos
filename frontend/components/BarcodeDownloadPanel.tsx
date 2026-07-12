"use client";

import { useId, useState } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BarcodeCanvas } from "@/components/BarcodeCanvas";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Shared by BarcodeLabelModal (Inventory row, after a product is saved) and
// ProductModal (right where the barcode is generated, before saving) — one
// implementation so a fix here applies everywhere the barcode can be
// downloaded or printed.
export function BarcodeDownloadPanel({ value, label }: { value: string; label: string }) {
  const canvasId = useId();
  const [format, setFormat] = useState<"EAN13" | "QR">("EAN13");
  const [imageType, setImageType] = useState<"png" | "jpg">("png");

  function getCanvas() {
    return document.getElementById(canvasId) as HTMLCanvasElement | null;
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
      link.download = `${value}.jpg`;
      link.href = flat.toDataURL("image/jpeg", 0.95);
    } else {
      link.download = `${value}.png`;
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
<title>${escapeHtml(label)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; text-align: center; padding: 24px; }
  img { max-width: 260px; }
  p { margin: 4px 0; font-size: 13px; }
</style>
</head>
<body onload="window.print()">
  <p><strong>${escapeHtml(label)}</strong></p>
  <img src="${dataUrl}" alt="${escapeHtml(value)}">
</body>
</html>`);
    win.document.close();
  }

  if (!value) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
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
        <BarcodeCanvas value={value} format={format} id={canvasId} />
      </div>

      <div className="flex items-center justify-center gap-3 text-sm">
        <span className="text-foreground/60">Download as</span>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={`${canvasId}-image-type`} checked={imageType === "png"} onChange={() => setImageType("png")} />
          PNG
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={`${canvasId}-image-type`} checked={imageType === "jpg"} onChange={() => setImageType("jpg")} />
          JPG
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
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
  );
}
