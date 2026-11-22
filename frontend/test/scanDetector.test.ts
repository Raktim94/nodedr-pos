import { test } from "node:test";
import assert from "node:assert/strict";
import { ScanDetector, type ScanOutcome } from "../lib/scanDetector.ts";

// Feed a string of characters `gap` ms apart starting at t0; returns the time of the last char.
function type(d: ScanDetector, text: string, t0: number, gap: number | number[]) {
  let t = t0;
  [...text].forEach((ch, i) => {
    if (i > 0) t += Array.isArray(gap) ? gap[i - 1] : gap;
    d.push({ key: ch, time: t });
  });
  return t;
}
const key = (d: ScanDetector, k: string, time: number, extra = {}): ScanOutcome => d.push({ key: k, time, ...extra });

test("fast scan + Enter is a scan", () => {
  const d = new ScanDetector();
  const t = type(d, "8901234567890", 1000, 8);
  assert.deepEqual(key(d, "Enter", t + 5), { kind: "scan", code: "8901234567890" });
});

test("old 50ms rule is no longer the limit: 70ms Bluetooth pauses in a fast burst still scan", () => {
  const d = new ScanDetector();
  const gaps = [5, 5, 5, 70, 5, 5, 5, 70, 5, 5, 5, 5]; // avg ~15ms
  const t = type(d, "8901234567890", 1000, gaps);
  assert.equal(key(d, "Enter", t + 10).kind, "scan");
});

test("Tab suffix completes a scan and is swallowed, not left to move focus", () => {
  const d = new ScanDetector();
  const t = type(d, "ABC12345", 0, 10);
  assert.deepEqual(key(d, "Tab", t + 10), { kind: "scan", code: "ABC12345" });
});

test("delayed Enter suffix (300ms after the last char) still completes the scan", () => {
  const d = new ScanDetector();
  const t = type(d, "123456789", 0, 10);
  assert.deepEqual(key(d, "Enter", t + 300), { kind: "scan", code: "123456789" });
});

test("trailing second suffix (Enter then Tab, or CR+LF) is swallowed and never a manual Enter", () => {
  const d = new ScanDetector();
  const t = type(d, "123456789", 0, 10);
  assert.equal(key(d, "Enter", t + 5).kind, "scan");
  assert.equal(key(d, "Tab", t + 20).kind, "swallow");
  assert.equal(key(d, "Enter", t + 400).kind, "swallow");
});

test("normal human typing is not a scan", () => {
  const d = new ScanDetector();
  const t = type(d, "milk", 0, 150);
  assert.equal(key(d, "Enter", t + 200).kind, "unsafe-enter");
});

test("fast human typing (~90ms/key) is not a scan", () => {
  const d = new ScanDetector();
  const t = type(d, "123456", 0, 90);
  assert.notEqual(key(d, "Enter", t + 100).kind, "scan");
});

test("too-short bursts are not scans", () => {
  const d = new ScanDetector();
  const t = type(d, "12", 0, 5);
  assert.notEqual(key(d, "Enter", t + 5).kind, "scan");
});

test("a very late suffix (>600ms) after a scan-speed burst must NOT finalize the sale", () => {
  const d = new ScanDetector();
  const t = type(d, "123456789", 0, 10);
  const out = key(d, "Enter", t + 1200);
  assert.equal(out.kind, "unsafe-enter");
});

test("a deliberate Enter with no recent typing is a safe manual Enter (finalize still works)", () => {
  const d = new ScanDetector();
  assert.equal(key(d, "Enter", 5000).kind, "manual-enter");
});

test("Enter right after a scan can't finalize the sale, but one 2s+ later can", () => {
  const d = new ScanDetector();
  const t = type(d, "123456789", 0, 10);
  key(d, "Enter", t + 5);
  assert.notEqual(key(d, "Enter", t + 300).kind, "manual-enter");
  assert.equal(key(d, "Enter", t + 5000).kind, "manual-enter");
});

test("held-down Enter (key repeat) never finalizes", () => {
  const d = new ScanDetector();
  assert.equal(key(d, "Enter", 9000, { repeat: true }).kind, "unsafe-enter");
});

test("plain Tab navigation is left alone", () => {
  const d = new ScanDetector();
  assert.equal(key(d, "Tab", 100).kind, "none");
});

test("Ctrl/Alt/Meta combos and IME composition are ignored", () => {
  const d = new ScanDetector();
  d.push({ key: "k", time: 0, ctrlKey: true });
  d.push({ key: "a", time: 5, isComposing: true });
  assert.equal(d.pending, "");
});

test("stale partial input does not contaminate the next scan", () => {
  const d = new ScanDetector();
  type(d, "zz", 0, 10);
  const t = type(d, "5551234", 5000, 8);
  assert.deepEqual(key(d, "Enter", t + 5), { kind: "scan", code: "5551234" });
});

test("two back-to-back scans each produce their own code", () => {
  const d = new ScanDetector();
  let t = type(d, "1111111", 0, 8);
  assert.deepEqual(key(d, "Enter", t + 5), { kind: "scan", code: "1111111" });
  t = type(d, "2222222", t + 100, 8);
  assert.deepEqual(key(d, "Enter", t + 5), { kind: "scan", code: "2222222" });
});

test("Shifted characters (uppercase, symbols) are kept in the code", () => {
  const d = new ScanDetector();
  const t = type(d, "AB-12/x", 0, 8);
  assert.deepEqual(key(d, "Enter", t + 5), { kind: "scan", code: "AB-12/x" });
});

import { routeKey } from "../lib/scanDetector.ts";
import { resolveScan } from "../lib/scanResolve.ts";

function harness() {
  const d = new ScanDetector();
  const calls = { scans: [] as string[], finalize: 0 };
  const h = { onScan: (c: string) => calls.scans.push(c), onManualEnter: () => calls.finalize++ };
  const press = (k: string, time: number, extra = {}) => routeKey(d, { key: k, time, ...extra }, h);
  const scan = (code: string, t0: number, gap = 8) => {
    [...code].forEach((c, i) => press(c, t0 + i * gap));
    return t0 + (code.length - 1) * gap;
  };
  return { calls, press, scan };
}

test("checkout safety: scan with Enter adds the item and never finalizes", () => {
  const { calls, press, scan } = harness();
  const t = scan("8901234567890", 0);
  assert.equal(press("Enter", t + 5), true); // suffix swallowed
  assert.deepEqual(calls, { scans: ["8901234567890"], finalize: 0 });
});

test("checkout safety: late Enter (1.5s) after scan-speed burst does not finalize", () => {
  const { calls, press, scan } = harness();
  const t = scan("8901234567890", 0);
  press("Enter", t + 1500);
  assert.equal(calls.finalize, 0);
});

test("checkout safety: Enter+Tab+Enter suffix train after a scan does not finalize", () => {
  const { calls, press, scan } = harness();
  const t = scan("8901234567890", 0);
  press("Enter", t + 5);
  press("Tab", t + 15);
  press("Enter", t + 500);
  assert.equal(calls.finalize, 0);
  assert.equal(calls.scans.length, 1);
});

test("manual Enter (cashier presses Enter to finalize) still works", () => {
  const { calls, press } = harness();
  press("Enter", 10_000);
  assert.equal(calls.finalize, 1);
});

test("scan then a real Enter 3s later finalizes", () => {
  const { calls, press, scan } = harness();
  const t = scan("8901234567890", 0);
  press("Enter", t + 5);
  press("Enter", t + 3000);
  assert.equal(calls.finalize, 1);
});

test("human typing a search then Enter neither scans nor finalizes, and isn't swallowed", () => {
  const { calls, press } = harness();
  "soap".split("").forEach((c, i) => press(c, i * 180));
  assert.equal(press("Enter", 800), false);
  assert.deepEqual(calls, { scans: [], finalize: 0 });
});

const notFound = () => Object.assign(new Error("nf"), { status: 404 });

test("resolveScan: matched product (barcode or SKU) -> product", async () => {
  const r = await resolveScan("123", { product: async () => ({ id: 1 }), customerByCard: async () => { throw notFound(); } });
  assert.deepEqual(r, { type: "product", product: { id: 1 } });
});

test("resolveScan: unknown code -> clear unmatched message naming the code", async () => {
  const r = await resolveScan("999000", { product: async () => { throw notFound(); }, customerByCard: async () => { throw notFound(); } });
  assert.equal(r.type, "unmatched");
  assert.match((r as { message: string }).message, /No product matches "999000"/);
});

test("resolveScan: loyalty card UID still resolves to a customer", async () => {
  const r = await resolveScan("CARD1", { product: async () => { throw notFound(); }, customerByCard: async () => ({ name: "A" }) });
  assert.equal(r.type, "customer");
});

test("resolveScan: server error is reported as a lookup failure, not 'unmatched'", async () => {
  const r = await resolveScan("123", { product: async () => { throw Object.assign(new Error("x"), { status: 500 }); }, customerByCard: async () => { throw notFound(); } });
  assert.deepEqual(r, { type: "error", message: "Lookup failed" });
});
