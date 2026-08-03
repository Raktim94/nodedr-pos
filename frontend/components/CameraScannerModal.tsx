"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Camera, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface CameraScannerModalProps {
  onClose: () => void;
  /** Called once per detected code. The caller decides what to do (e.g. add to cart, fill a field). */
  onScan: (code: string) => void;
}

type FacingMode = "environment" | "user";
type Status = "starting" | "scanning" | "error";

// The caller is expected to only mount this component while the scanner
// should be open (e.g. `{open && <CameraScannerModal ... />}`) rather than
// keeping it always mounted and toggling an `open` prop. That way a fresh
// mount naturally starts from a clean state, with no need to reset state
// from inside an effect in response to a prop change.
//
// zxing fires the decode callback on *every* frame, with `error` set to a
// NotFoundException whenever no code is in view — that's the normal "still
// looking" state, not a real failure, so it's deliberately ignored below.
// Only a rejection of decodeFromConstraints itself (camera permission
// denied, no camera, stream failed to start) is treated as an error.
export function CameraScannerModal({ onClose, onScan }: CameraScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [status, setStatus] = useState<Status>("starting");
  const [errorMessage, setErrorMessage] = useState("");
  const [canFlip, setCanFlip] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!videoRef.current) return;

    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | null = null;
    let cancelled = false;

    setStatus("starting");

    // Browsers only expose getUserMedia on a secure context (https:// or
    // localhost) — on an insecure origin (e.g. this app's LAN IP over plain
    // http://, which is how it's normally reached from a phone/tablet via
    // Docker) `navigator.mediaDevices` is simply undefined and no permission
    // prompt is ever shown. Catch that up front with an accurate message
    // instead of letting it fall through to the generic "could not start"
    // error below, since "try again" can never fix this — it's not transient.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      queueMicrotask(() => {
        if (cancelled) return;
        setErrorMessage(
          "Camera access needs a secure connection (https://) or 'localhost' — browsers block it on a plain http:// network address like this one. Use the hardware barcode scanner instead, or see the README's Camera scanning section for how to enable this over your LAN."
        );
        setStatus("error");
      });
      return;
    }

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: facingMode } } },
        videoRef.current,
        (result) => {
          if (cancelled || !result) return;
          onScanRef.current(result.getText());
        }
      )
      .then((c) => {
        if (cancelled) {
          c.stop();
          return;
        }
        controls = c;
        setStatus("scanning");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setErrorMessage("Camera access was denied. Allow camera permission in your browser and try again.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          // OverconstrainedError here usually means this device has no
          // back/front distinction (e.g. a laptop) — retry with no facing
          // preference at all instead of just giving up.
          if (name === "OverconstrainedError") {
            setCanFlip(false);
            reader
              .decodeFromConstraints({ video: true }, videoRef.current!, (result) => {
                if (!cancelled && result) onScanRef.current(result.getText());
              })
              .then((c) => {
                if (cancelled) return c.stop();
                controls = c;
                setStatus("scanning");
              })
              .catch(() => setErrorMessage("Could not access any camera on this device."));
            return;
          }
          setErrorMessage("No camera was found on this device.");
        } else {
          setErrorMessage("Could not start the camera. Please try again.");
        }
        setStatus("error");
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [facingMode, retryNonce]);

  const flipCamera = useCallback(() => {
    setFacingMode((mode) => (mode === "environment" ? "user" : "environment"));
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Scan a barcode or QR code"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Camera className="h-4 w-4 text-brand" aria-hidden="true" />
            Scan barcode or QR code
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="rounded-lg p-1.5 text-foreground/60 transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="relative aspect-square bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />

          {status !== "error" && (
            <div className="pointer-events-none absolute inset-10 rounded-2xl border-2 border-brand/80 shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]" />
          )}

          {status === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-medium text-white">
              Starting camera…
            </div>
          )}

          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center text-sm text-white">
              <p>{errorMessage}</p>
              <Button type="button" variant="secondary" onClick={() => setRetryNonce((n) => n + 1)}>
                Try again
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-xs text-foreground/50">
            {status === "scanning" ? "Point the camera at a code — it scans automatically." : " "}
          </p>
          {canFlip && (
            <Button type="button" variant="secondary" onClick={flipCamera}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Flip camera
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
