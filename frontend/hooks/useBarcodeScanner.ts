"use client";

import { useEffect, useRef } from "react";
import { ScanDetector, routeKey } from "@/lib/scanDetector";

// Keyboard-wedge (USB / Bluetooth HID) scanner support. All timing rules live
// in lib/scanDetector.ts; this hook only wires it to window keydown events.

interface UseBarcodeScannerOptions {
  /** Called with the scanned code once a fast keystroke run ends in Enter or Tab. */
  onScan: (code: string) => void;
  /** Called for a genuine human Enter (never for a scan or a scan's trailing suffix). */
  onManualEnter?: (event: KeyboardEvent) => void;
  enabled?: boolean;
}

/** Remove scanner characters that were typed into a focused text field before we knew it was a scan. */
function stripFromField(target: EventTarget | null, code: string) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  if (!target.value.endsWith(code)) return;
  const proto = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) return;
  setter.call(target, target.value.slice(0, target.value.length - code.length));
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

export function useBarcodeScanner({ onScan, onManualEnter, enabled = true }: UseBarcodeScannerOptions) {
  const onScanRef = useRef(onScan);
  const onManualEnterRef = useRef(onManualEnter);

  useEffect(() => {
    onScanRef.current = onScan;
    onManualEnterRef.current = onManualEnter;
  });

  useEffect(() => {
    if (!enabled) return;
    const detector = new ScanDetector();

    function handleKeyDown(event: KeyboardEvent) {
      let scanned: string | null = null;
      const swallow = routeKey(
        detector,
        {
          key: event.key,
          time: performance.now(),
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          repeat: event.repeat,
          isComposing: event.isComposing,
        },
        {
          onScan: (code) => {
            scanned = code;
          },
          onManualEnter: () => onManualEnterRef.current?.(event),
        }
      );
      if (swallow) {
        // Stop Enter submitting a form and Tab moving focus away.
        event.preventDefault();
        event.stopPropagation();
      }
      if (scanned !== null) {
        stripFromField(event.target, scanned);
        onScanRef.current(scanned);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled]);
}
