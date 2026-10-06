const prisma = require('./prisma');
const { CURRENCIES } = require('./currency');

function parseRates(settings) {
  try {
    return settings?.fxRates ? JSON.parse(settings.fxRates) : {};
  } catch {
    return {};
  }
}

// Pull live rates (optional — the app stays fully usable offline with
// manually entered rates). open.er-api.com is a free, key-less endpoint that
// returns "1 BASE = x FOREIGN"; we store the inverse, "base units per 1
// foreign unit", because that is what a cashier reasons in ("1 USD = Rs 83").
async function refreshLiveRates(base) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`rate service responded ${res.status}`);
  const j = await res.json();
  if (j.result !== 'success' || !j.rates) throw new Error('rate service returned no rates');
  const rates = {};
  for (const code of Object.keys(CURRENCIES)) {
    if (code === base) continue;
    const perBase = j.rates[code];
    if (typeof perBase === 'number' && perBase > 0) rates[code] = Math.round((1 / perBase) * 1e6) / 1e6;
  }
  return rates;
}

async function saveRates(rates) {
  const s = await prisma.shopSettings.findFirst();
  if (!s) throw new Error('No shop settings');
  return prisma.shopSettings.update({ where: { id: s.id }, data: { fxRates: JSON.stringify(rates), fxUpdatedAt: new Date() } });
}

module.exports = { parseRates, refreshLiveRates, saveRates };
