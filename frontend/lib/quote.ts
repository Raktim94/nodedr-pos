import type { CartItem, ShopSettings } from "./types";
import { round2 } from "./format";

export interface QuoteInput {
  cart: CartItem[];
  discountType: "percent" | "amount" | null;
  discountValue: number;
  pointsRedeemed: number;
  settings: ShopSettings | undefined;
}

export interface Quote {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  loyaltyDiscount: number;
  total: number;
  pointsEarned: number;
}

// Client-side preview of the sale totals. Mirrors the backend pricing engine
// (backend/src/lib/pricing.js) so the cashier sees accurate numbers before
// checkout — the server always recomputes authoritatively on submit.
export function quoteSale({ cart, discountType, discountValue, pointsRedeemed, settings }: QuoteInput): Quote {
  const gstEnabled = !!settings?.gstEnabled;
  const bases = cart.map((c) => round2(c.product.sellingPrice * c.quantity));
  const subtotal = round2(bases.reduce((a, b) => a + b, 0));

  let discountAmount = 0;
  if (discountType === "percent") discountAmount = round2(subtotal * (Math.min(discountValue, 100) / 100));
  else if (discountType === "amount") discountAmount = round2(Math.min(discountValue, subtotal));
  discountAmount = Math.max(0, Math.min(discountAmount, subtotal));

  let taxAmount = 0;
  cart.forEach((c, i) => {
    const share = subtotal > 0 ? bases[i] / subtotal : 0;
    const discountedBase = round2(bases[i] - round2(discountAmount * share));
    const rate = gstEnabled ? c.product.taxRate || 0 : 0;
    taxAmount = round2(taxAmount + round2(discountedBase * (rate / 100)));
  });

  const loyaltyEnabled = !!settings?.loyaltyEnabled;
  const pointValue = loyaltyEnabled ? settings!.pointValue || 0 : 0;
  const preLoyalty = round2(subtotal - discountAmount + taxAmount);
  let loyaltyDiscount = round2(Math.max(0, Math.floor(pointsRedeemed)) * pointValue);
  if (loyaltyDiscount > preLoyalty) loyaltyDiscount = preLoyalty;

  const total = round2(preLoyalty - loyaltyDiscount);
  const pointsPerUnit = loyaltyEnabled ? settings!.pointsPerUnit || 0 : 0;
  const pointsEarned = loyaltyEnabled ? Math.floor(total * pointsPerUnit) : 0;

  return { subtotal, discountAmount, taxAmount, loyaltyDiscount, total, pointsEarned };
}
