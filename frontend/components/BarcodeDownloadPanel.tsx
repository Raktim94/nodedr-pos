"use client";

import { useId, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BarcodeCanvas } from "@/components/BarcodeCanvas";

// Shared by BarcodeLabelModal (Inventory row, after a product is saved) and
// ProductModal (right where the barcode is generated, before saving) — one
// implementation so a fix here applies everywhere the barcode can be
// downloaded. Downloads the barcode as a PNG/JPG image; the shopkeeper prints
// that file with their own label software (no in-app print — it opened an
// extra browser tab and clipped on thermal label printers).
export function BarcodeDownloadPanel({ value }: { value: string }) {
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

      <Button type="button" variant="secondary" onClick={download} className="w-full">
        <Download className="h-4 w-4" aria-hidden="true" />
        Download {imageType.toUpperCase()}
      </Button>
    </div>
  );
}
