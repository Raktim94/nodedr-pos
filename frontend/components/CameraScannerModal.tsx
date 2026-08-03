"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { Camera, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface CameraScannerModalProps {
  onClose: () => void;
  /** Called once per detected code. The caller decides what to do (e.g. add to cart, fill a field). */
  onScan: (code: string) => void;
}

type FacingMode = "environment" | "user";
type Status = "starting" | "scanning" | "error";

// Deliberately NOT setting POSSIBLE_FORMATS: zxing's own default (no hints
// at all) already tries every format it supports (all 1D formats, QR,
// MicroQR, DataMatrix, Aztec, PDF417, MaxiCode — see
// MultiFormatReader.setHints in @zxing/library). An earlier version of this
// file restricted to a "the formats this app actually uses" allowlist,
// which was a real regression: it's strictly narrower than the default, so
// any real-world product using a format outside that list (DataMatrix/GS1
// on pharmacy items, CODABAR on some coupons, etc.) would silently stop
// decoding. TRY_HARDER alone is a pure win — more thorough per-frame
// decoding, no narrowing of what's recognized.
const SCAN_HINTS = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);

// Best-effort: ask the browser to keep refocusing on whatever's in frame,
// rather than locking focus once at startup (the actual cause of "camera
// won't focus" reports — a barcode held a few inches from the lens is
// outside a phone's default focus distance if focus locked before the code
// was even in view). Not universally supported (notably iOS Safari has no
// programmatic focus control at all), so this is wrapped defensively and
// silently does nothing where it isn't — there's no working fallback for
// those devices beyond physically moving the phone until focus catches up.
function applyContinuousFocus(controls: IScannerControls) {
  try {
    // `focusMode` is part of the MediaTrack Image Capture extensions, not
    // the core getUserMedia spec TypeScript's lib.dom.d.ts ships — hence
    // the cast. An inline `satisfies` isn't enough here, since the literal
    // is also contextually checked against the callee's own (un-extended)
    // parameter type.
    controls.streamVideoConstraintsApply?.({ advanced: [{ focusMode: "continuous" }] } as unknown as MediaTrackConstraints);
  } catch {
    // Unsupported browser/device — nothing more to do here.
  }
}

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

    const reader = new BrowserMultiFormatReader(SCAN_HINTS);
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

    // Ask for a high-resolution frame, not just whatever low default the
    // browser picks — a small barcode/QR code needs enough pixels to
    // resolve cleanly, and this was previously unconstrained.
    const idealVideoConstraints: MediaTrackConstraints = {
      facingMode: { ideal: facingMode },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };

    reader
      .decodeFromConstraints(
        { video: idealVideoConstraints },
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
        applyContinuousFocus(c);
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
              .decodeFromConstraints(
                { video: { width: { ideal: 1920 }, height: { ideal: 1080 } } },
                videoRef.current!,
                (result) => {
                  if (!cancelled && result) onScanRef.current(result.getText());
                }
              )
              .then((c) => {
                if (cancelled) return c.stop();
                controls = c;
                applyContinuousFocus(c);
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
