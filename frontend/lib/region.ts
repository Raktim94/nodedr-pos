// Where the shop trades decides which local features exist. Mirrors
// backend/src/lib/region.js.
export const SPAIN_CURRENCY = "EUR";

// VERI*FACTU (Spanish tax-authority invoicing) applies to shops that invoice in euros.
export const verifactuAvailable = (shop: { currencyCode: string }): boolean => shop.currencyCode === SPAIN_CURRENCY;
