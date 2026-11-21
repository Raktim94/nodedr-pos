// What a scanned code means at POS Checkout: a product (barcode or external
// SKU), else an NFC loyalty card (those type a UID like a scanner), else
// nothing. Pure, with the lookups injected, so it can be unit-tested.

export type ScanResolution<P, C> =
  | { type: "product"; product: P }
  | { type: "customer"; customer: C }
  | { type: "unmatched"; message: string }
  | { type: "error"; message: string };

const isNotFound = (err: unknown) => (err as { status?: number } | null)?.status === 404;

export const unmatchedMessage = (code: string) =>
  `No product matches "${code}". Add it to Inventory first, or check the barcode/SKU.`;

export async function resolveScan<P, C>(
  code: string,
  lookups: {
    product: (code: string) => Promise<P>;
    customerByCard: (code: string) => Promise<C>;
  }
): Promise<ScanResolution<P, C>> {
  try {
    return { type: "product", product: await lookups.product(code) };
  } catch (err) {
    if (!isNotFound(err)) return { type: "error", message: "Lookup failed" };
  }
  try {
    return { type: "customer", customer: await lookups.customerByCard(code) };
  } catch {
    return { type: "unmatched", message: unmatchedMessage(code) };
  }
}
