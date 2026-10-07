import { api } from "@/lib/api";
import type { ProductLookupResponse, ProductLookupResult } from "@/lib/types";

// Fast single-barcode lookup against the online product databases. Returns the
// match, or null when nobody has it. Throws ApiError when the databases could
// not be reached — callers should fall back to manual entry.
export async function lookupBarcode(code: string): Promise<ProductLookupResult | null> {
  const r = await api.get<ProductLookupResponse>(`/products/lookup?q=${encodeURIComponent(code.trim())}`);
  return r.results[0] ?? null;
}
