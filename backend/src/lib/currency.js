// Supported currencies and their default symbols. The active currency is
// stored in ShopSettings; the frontend formats amounts using the symbol.
// This is a curated set of major/regionally-relevant currencies, not the
// full ISO 4217 list.
const CURRENCIES = {
  INR: { symbol: 'Rs.', label: 'Indian Rupee' },
  USD: { symbol: '$', label: 'US Dollar' },
  EUR: { symbol: '€', label: 'Euro' },
  GBP: { symbol: '£', label: 'British Pound' },
  AED: { symbol: 'د.إ', label: 'UAE Dirham' },
  AUD: { symbol: 'A$', label: 'Australian Dollar' },
  CAD: { symbol: 'C$', label: 'Canadian Dollar' },
  SGD: { symbol: 'S$', label: 'Singapore Dollar' },
  JPY: { symbol: '¥', label: 'Japanese Yen' },
  CNY: { symbol: '¥', label: 'Chinese Yuan' },
  CHF: { symbol: 'Fr.', label: 'Swiss Franc' },
  NZD: { symbol: 'NZ$', label: 'New Zealand Dollar' },
  ZAR: { symbol: 'R', label: 'South African Rand' },
  SAR: { symbol: '﷼', label: 'Saudi Riyal' },
  QAR: { symbol: '﷼', label: 'Qatari Riyal' },
  THB: { symbol: '฿', label: 'Thai Baht' },
  MYR: { symbol: 'RM', label: 'Malaysian Ringgit' },
  IDR: { symbol: 'Rp', label: 'Indonesian Rupiah' },
  PHP: { symbol: '₱', label: 'Philippine Peso' },
  BDT: { symbol: '৳', label: 'Bangladeshi Taka' },
  NPR: { symbol: 'Rs.', label: 'Nepalese Rupee' },
  LKR: { symbol: 'Rs.', label: 'Sri Lankan Rupee' },
  PKR: { symbol: 'Rs.', label: 'Pakistani Rupee' },
};

function symbolFor(code, fallback) {
  return CURRENCIES[code]?.symbol || fallback || code;
}

module.exports = { CURRENCIES, symbolFor };
