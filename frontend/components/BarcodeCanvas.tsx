"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

export function BarcodeCanvas({
  value,
  format,
  className,
}: {
  value: string;
  format: "EAN13" | "QR";
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;

    if (format === "QR") {
      QRCode.toCanvas(canvas, value, { width: 220, margin: 1 });
      return;
    }

    try {
      JsBarcode(canvas, value, { format: "EAN13", width: 2, height: 70, displayValue: true, margin: 8 });
    } catch {
      // Not a valid EAN-13 (e.g. a manufacturer barcode in a different
      // format) — CODE128 accepts any string, so the label still renders.
      JsBarcode(canvas, value, { format: "CODE128", width: 2, height: 70, displayValue: true, margin: 8 });
    }
  }, [value, format]);

  return <canvas ref={canvasRef} id="barcode-label-canvas" className={className} />;
}
