"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";

// Dynamic UPI QR for the exact amount due: the backend builds the NPCI
// deep link from the shop's UPI id; the customer scans it with any UPI app.
export function UpiQr({ amount, reference, onUri }: { amount: number; reference?: string; onUri?: (uri: string | null) => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!(amount > 0)) return;
    api
      .get<{ uri: string; vpa: string }>(`/payments/upi?amount=${amount}${reference ? `&ref=${encodeURIComponent(reference)}` : ""}`)
      .then(async (r) => {
        const data = await QRCode.toDataURL(r.uri, { margin: 1, width: 240, errorCorrectionLevel: "M" });
        if (!cancelled) {
          setImg(data);
          setErr("");
          onUri?.(r.uri);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e?.message || "Could not build the UPI QR");
          onUri?.(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [amount, reference, onUri]);

  if (!(amount > 0)) return null;
  if (err) return <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">{err}</p>;
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-white p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img ? <img src={img} alt={`UPI payment QR for ${amount}`} width={200} height={200} /> : <div className="h-[200px] w-[200px] animate-pulse rounded bg-surface-muted" />}
      <p className="text-xs font-medium text-[#17251d]">Scan with any UPI app · exact amount pre-filled</p>
    </div>
  );
}
