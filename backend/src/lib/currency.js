// Supported currencies and their default symbols. The active currency is
// stored in ShopSettings; the frontend formats amounts using the symbol.
const CURRENCIES = {
  INR: { symbol: 'Rs.', label: 'Indian Rupee' },
  USD: { symbol: '$', label: 'US Dollar' },
  EUR: { symbol: '€', label: 'Euro' },
  GBP: { symbol: '£', label: 'British Pound' },
};

function symbolFor(code, fallback) {
  return CURRENCIES[code]?.symbol || fallback || code;
}

module.exports = { CURRENCIES, symbolFor };
