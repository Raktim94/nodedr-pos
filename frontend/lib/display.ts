// Customer-facing display: a second browser window (usually on the second
// monitor of the same till) mirrors the cart. BroadcastChannel keeps it
// entirely client-side — no extra server load, works offline, and the data
// never leaves the machine.
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

export function postDisplay(state: DisplayState) {
  try {
    const ch = new BroadcastChannel(DISPLAY_CHANNEL);
    ch.postMessage(state);
    ch.close();
  } catch {
    // BroadcastChannel unsupported — the display simply stays idle.
  }
}
