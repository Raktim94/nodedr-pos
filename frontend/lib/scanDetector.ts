// Keyboard-wedge (HID) barcode scanner detection — pure logic, no DOM, so the
// timing rules can be unit-tested (see test/scanDetector.test.ts).
//
// A scanner "types" the code and then a suffix key (Enter, or Tab on many
// units). Humans type far slower, so a scan is recognised by speed *averaged
// over the burst*, not by a hard per-key cutoff — Bluetooth scanners batch
// keys and routinely pause 50-100 ms mid-code, and many add the suffix late.

/** Longest pause between two characters before the burst is considered broken. */
export const MAX_CHAR_GAP_MS = 120;
/** Average gap across the code. Scanners are ~1-30 ms; fast human typing is 80+ ms. */
export const MAX_AVG_GAP_MS = 45;
/** How long after the last character a suffix (Enter/Tab) still counts as the scan's suffix. */
export const SUFFIX_TIMEOUT_MS = 600;
/** After a scan, further Enter/Tab keys (CR+LF, Enter+Tab, double suffix) are swallowed for this long. */
export const POST_SCAN_QUIET_MS = 800;
/** A manual Enter never finalizes a sale if printable keys were typed this recently (late-suffix safety). */
export const RECENT_TYPING_MS = 2000;
export const MIN_CODE_LENGTH = 3;
export const MAX_CODE_LENGTH = 64;

export type KeyInput = {
  key: string;
  time: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
};

export type ScanOutcome =
  /** A complete scan: add this code. Caller should preventDefault the suffix key. */
  | { kind: "scan"; code: string }
  /** A suffix key that belongs to a scan that was already handled — swallow it. */
  | { kind: "swallow" }
  /** A human Enter that is safe to treat as "finalize". */
  | { kind: "manual-enter" }
  /** An Enter that must NOT finalize (typing just happened, or key repeat) but should otherwise behave normally. */
  | { kind: "unsafe-enter" }
  /** Nothing to do (character buffered, or an unrelated key). */
  | { kind: "none" };

export class ScanDetector {
  private buffer = "";
  private lastCharTime = -Infinity;
  private gapSum = 0;
  private lastScanTime = -Infinity;

  reset() {
    this.buffer = "";
    this.gapSum = 0;
  }

  /** The characters currently buffered (used to clean up text that leaked into a focused input). */
  get pending() {
    return this.buffer;
  }

  push(e: KeyInput): ScanOutcome {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return { kind: "none" };

    const isSuffix = e.key === "Enter" || e.key === "Tab";
    if (isSuffix) return this.suffix(e);

    if (e.key.length !== 1) return { kind: "none" }; // Shift, arrows, F-keys…

    const gap = e.time - this.lastCharTime;
    if (this.buffer === "" || gap > MAX_CHAR_GAP_MS) {
      this.buffer = e.key;
      this.gapSum = 0;
    } else if (this.buffer.length < MAX_CODE_LENGTH) {
      this.buffer += e.key;
      this.gapSum += gap;
    }
    this.lastCharTime = e.time;
    return { kind: "none" };
  }

  private suffix(e: KeyInput): ScanOutcome {
    const sinceChar = e.time - this.lastCharTime;
    const code = this.buffer;
    const avgGap = code.length > 1 ? this.gapSum / (code.length - 1) : Infinity;
    const isScan =
      code.length >= MIN_CODE_LENGTH && avgGap <= MAX_AVG_GAP_MS && sinceChar <= SUFFIX_TIMEOUT_MS;

    if (isScan) {
      this.reset();
      this.lastScanTime = e.time;
      return { kind: "scan", code };
    }

    // Extra suffix keys trailing a scan we already consumed.
    if (e.time - this.lastScanTime <= POST_SCAN_QUIET_MS) {
      this.reset();
      return { kind: "swallow" };
    }

    // Printable keys arrived moments ago but did not qualify as a scan (slow
    // Bluetooth burst, very late suffix): never let this Enter finalize a sale.
    const recentlyTyped = code.length > 0 && sinceChar <= RECENT_TYPING_MS;
    this.reset();
    if (e.key === "Enter" && recentlyTyped) return { kind: "unsafe-enter" };

    if (e.key === "Tab") return { kind: "none" }; // ordinary Tab navigation
    if (e.repeat) return { kind: "unsafe-enter" };
    return { kind: "manual-enter" };
  }
}

export type ScanHandlers = {
  onScan: (code: string) => void;
  /** Only ever called for a deliberate human Enter that is safe to treat as "finalize". */
  onManualEnter?: () => void;
};

/**
 * Route one key event through the detector and the handlers. Returns true when
 * the caller must preventDefault/stopPropagation (scan suffix keys), so Enter
 * can't submit a form and Tab can't move focus.
 */
export function routeKey(detector: ScanDetector, e: KeyInput, h: ScanHandlers): boolean {
  const out = detector.push(e);
  if (out.kind === "scan") {
    h.onScan(out.code);
    return true;
  }
  if (out.kind === "swallow") return true;
  if (out.kind === "manual-enter") h.onManualEnter?.();
  return false;
}
