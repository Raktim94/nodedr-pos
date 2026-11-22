// Formats a numeric amount with the shop's currency symbol. Kept trivial and
// symbol-based (rather than Intl locale currency) so the shop's chosen symbol
// always renders exactly as configured, including "Rs.".
export const DEFAULT_CURRENCY_SYMBOL = "Rs.";

// The symbol every screen shows before the shop settings have loaded (or when
// none is configured).
export const currencySymbolOf = (shop: { currencySymbol?: string | null } | null | undefined): string =>
  shop?.currencySymbol || DEFAULT_CURRENCY_SYMBOL;

export function formatMoney(amount: number, symbol = DEFAULT_CURRENCY_SYMBOL): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `${symbol} ${n.toFixed(2)}`;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
