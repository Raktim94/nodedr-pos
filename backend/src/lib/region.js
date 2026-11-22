// Where the shop trades decides which local rules apply. Every region-specific
// branch asks one of these, so adding a market means editing this file rather
// than hunting for `currencyCode === ...` and `vfEnabled` checks.

const SPAIN_CURRENCY = 'EUR';
const INDIA_CURRENCY = 'INR';

// Spain wording on customer documents: IVA, the NIF, a simplified-invoice
// title. Follows the shop turning VERI*FACTU on.
const usesSpanishInvoices = (shop) => !!shop?.vfEnabled;

// VERI*FACTU records are produced only for a Spanish (euro) shop that enabled it.
const verifactuActive = (shop) => !!shop?.vfEnabled && shop.currencyCode === SPAIN_CURRENCY;

// UPI payment links and QR codes exist only for rupee shops.
const supportsUpi = (shop) => shop?.currencyCode === INDIA_CURRENCY;

// Customer phone numbers are stored without a country code; add India's
// when a 10-digit number is used to open a WhatsApp link from a rupee shop.
const withCountryPrefix = (shop, phone) => (phone.length === 10 && shop?.currencyCode === INDIA_CURRENCY ? `91${phone}` : phone);

module.exports = { SPAIN_CURRENCY, usesSpanishInvoices, verifactuActive, supportsUpi, withCountryPrefix };
