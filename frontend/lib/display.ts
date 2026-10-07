// Customer-facing display. The till publishes what the customer should see two
// ways: BroadcastChannel (instant, for a window in the same browser) and the
// server (/api/display/state) so ANY other device — a phone, a tablet, a second
// monitor on another PC — that opens /display?key=… follows it over the LAN.
export interface DisplayState {
  shopName: string;
  symbol: string;
  lines: { name: string; qty: number; unit: string | null; price: number; total: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  // When set the display shows this payment QR instead of the item list.
  upiUri?: string | null;
  thankYou?: boolean;
}

export const DISPLAY_CHANNEL = "nodedr-pos-display";

let lastSent = "";
let timer: ReturnType<typeof setTimeout> | undefined;

export function postDisplay(state: DisplayState) {
  try {
    const ch = new BroadcastChannel(DISPLAY_CHANNEL);
    ch.postMessage(state);
    ch.close();
  } catch {
    // BroadcastChannel unsupported — same-browser mirroring is simply off.
  }
  // Server copy for other devices: skip unchanged states, coalesce bursts.
  const body = JSON.stringify(state);
  if (body === lastSent) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    lastSent = body;
    fetch("/api/display/state", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body }).catch(() => {
      lastSent = ""; // retry on the next change
    });
  }, 150);
}
