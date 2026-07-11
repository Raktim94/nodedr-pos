"use client";

import { useEffect, useRef } from "react";

// USB barcode scanners act as HID keyboards and fire keystrokes far faster
// than a human can type — typically under 20ms apart — then send Enter.
// We classify a keystroke run as a "scan" when every character in the run
// arrived within MAX_INTERVAL_MS of the previous one and the run ends with
// Enter arriving within that same window. Anything slower is treated as a
// human typing normally, so this hook never interferes with real input.
const MAX_INTERVAL_MS = 50;
const MIN_BARCODE_LENGTH = 3;

interface UseBarcodeScannerOptions {
  /** Called with the scanned code once a fast keystroke run ends in Enter. */
  onScan: (code: string) => void;
  /** Called when Enter is pressed but the keystrokes leading up to it were NOT a scan. */
  onManualEnter?: (event: KeyboardEvent) => void;
  enabled?: boolean;
}

export function useBarcodeScanner({ onScan, onManualEnter, enabled = true }: UseBarcodeScannerOptions) {
  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  const onManualEnterRef = useRef(onManualEnter);

  // Keep the "latest callback" refs in sync after every render (not during
  // render, which the react-hooks/refs rule disallows).
  useEffect(() => {
    onScanRef.current = onScan;
    onManualEnterRef.current = onManualEnter;
  });

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      const now = performance.now();
      const elapsed = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (elapsed > MAX_INTERVAL_MS) {
        bufferRef.current = "";
      }

      if (event.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current = "";
        const isScan = code.length >= MIN_BARCODE_LENGTH && elapsed <= MAX_INTERVAL_MS;

        if (isScan) {
          event.preventDefault();
          onScanRef.current(code);
        } else {
          onManualEnterRef.current?.(event);
        }
        return;
      }

      if (event.key.length === 1) {
        bufferRef.current += event.key;
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled]);
}
