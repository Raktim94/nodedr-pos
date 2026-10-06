"use client";

import { useEffect, useState } from "react";
import { DISPLAY_CHANNEL, type DisplayState } from "@/lib/display";

// Second-screen display for the customer. Mirrors the cashier's cart via
// BroadcastChannel (same browser, same machine) — open it from POS Checkout
// and drag the window to the customer-facing monitor.
export default function CustomerDisplay() {
  const [s, setS] = useState<DisplayState | null>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(DISPLAY_CHANNEL);
    ch.onmessage = (e: MessageEvent<DisplayState>) => setS(e.data);
    return () => ch.close();
  }, []);

  const money = (n: number) => `${s?.symbol ?? ""} ${n.toFixed(2)}`;
  const idle = !s || (s.lines.length === 0 && !s.thankYou);

  return (
    <main className="flex min-h-screen flex-col bg-[var(--green-950)] p-8 text-white">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{s?.shopName || "Welcome"}</h1>
        <p className="text-sm text-white/60">{new Date().toLocaleDateString()}</p>
      </header>

      {s?.thankYou ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-5xl font-semibold tracking-tight">Thank you!</p>
          <p className="text-lg text-white/70">Please visit again.</p>
        </div>
      ) : idle ? (
        <div className="flex flex-1 items-center justify-center text-center">
          <p className="text-3xl text-white/70">Hello 👋 — your items will appear here.</p>
        </div>
      ) : (
        <>
          <ul className="my-6 flex-1 divide-y divide-white/10 overflow-y-auto" aria-label="Items">
            {s!.lines.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-3 text-xl">
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className="tabular text-white/60">
                  {l.qty}{l.unit ? ` ${l.unit}` : ""} × {money(l.price)}
                </span>
                <span className="tabular w-36 text-right font-medium">{money(l.total)}</span>
              </li>
            ))}
          </ul>
          <footer className="rounded-2xl bg-white/10 p-6">
            {s!.discount > 0 && (
              <p className="tabular flex justify-between text-lg text-white/70">
                <span>Discount</span>
                <span>- {money(s!.discount)}</span>
              </p>
            )}
            {s!.tax > 0 && (
              <p className="tabular flex justify-between text-lg text-white/70">
                <span>GST (included)</span>
                <span>{money(s!.tax)}</span>
              </p>
            )}
            <p className="tabular mt-1 flex justify-between text-5xl font-semibold tracking-[-0.03em]">
              <span>Total</span>
              <span>{money(s!.total)}</span>
            </p>
          </footer>
        </>
      )}
    </main>
  );
}
