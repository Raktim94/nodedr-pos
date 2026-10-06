// Card-terminal drivers (server-driven flows, no browser SDK needed):
//   Stripe Terminal — PaymentIntent (card_present) pushed to a registered reader
//   Square Terminal — Terminal Checkout pushed to a paired device
// Credentials come from ShopSettings.terminalConfigEnc (AES-GCM, secretBox).
//
// STATUS: written against the providers' public REST docs and unit-tested for
// request shape only. It has NOT been exercised against a live reader/device
// from this repository — pilot with a test-mode key and a real terminal
// before relying on it at the till.
const prisma = require('./prisma');
const { decryptJson } = require('./secretBox');

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND']);
const toMinor = (amount, currency) => (ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100));
const fromMinor = (minor, currency) => (ZERO_DECIMAL.has(currency) ? minor : minor / 100);

async function loadConfig() {
  const settings = await prisma.shopSettings.findFirst();
  if (!settings || settings.terminalProvider === 'none') {
    throw Object.assign(new Error('No card terminal is configured (Settings > Payments)'), { status: 409 });
  }
  const cfg = decryptJson(settings.terminalConfigEnc);
  if (!cfg?.secret) throw Object.assign(new Error('Card terminal credentials are missing or unreadable'), { status: 409 });
  return { provider: settings.terminalProvider, cfg, currency: settings.currencyCode };
}

async function http(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.errors?.[0]?.detail || `Terminal provider responded ${res.status}`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return json;
}

const stripeForm = (obj) => new URLSearchParams(obj).toString();
const stripeHeaders = (cfg) => ({ Authorization: `Bearer ${cfg.secret}`, 'Content-Type': 'application/x-www-form-urlencoded' });
const squareBase = (cfg) => (cfg.sandbox ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com');
const squareHeaders = (cfg) => ({ Authorization: `Bearer ${cfg.secret}`, 'Content-Type': 'application/json', 'Square-Version': '2024-10-17' });

// Start a charge on the reader. Returns { provider, id } — poll getStatus(id).
async function startCharge({ amount, reference }) {
  const { provider, cfg, currency } = await loadConfig();
  const minor = toMinor(amount, currency);
  if (!(minor > 0)) throw Object.assign(new Error('Amount must be greater than zero'), { status: 400 });

  if (provider === 'stripe') {
    if (!cfg.readerId) throw Object.assign(new Error('Stripe reader id is not configured'), { status: 409 });
    const pi = await http('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: stripeHeaders(cfg),
      body: stripeForm({ amount: minor, currency: currency.toLowerCase(), 'payment_method_types[]': 'card_present', capture_method: 'automatic', 'metadata[ref]': reference || '' }),
    });
    await http(`https://api.stripe.com/v1/terminal/readers/${encodeURIComponent(cfg.readerId)}/process_payment_intent`, {
      method: 'POST',
      headers: stripeHeaders(cfg),
      body: stripeForm({ payment_intent: pi.id }),
    });
    return { provider, id: pi.id };
  }

  if (provider === 'square') {
    if (!cfg.deviceId) throw Object.assign(new Error('Square device id is not configured'), { status: 409 });
    const out = await http(`${squareBase(cfg)}/v2/terminals/checkouts`, {
      method: 'POST',
      headers: squareHeaders(cfg),
      body: JSON.stringify({
        idempotency_key: `${reference || 'sale'}-${Date.now()}`,
        checkout: { amount_money: { amount: minor, currency }, reference_id: String(reference || '').slice(0, 40), device_options: { device_id: cfg.deviceId } },
      }),
    });
    return { provider, id: out.checkout.id };
  }
  throw Object.assign(new Error('Unsupported terminal provider'), { status: 409 });
}

// -> { status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED', amount, currency }
async function getStatus(id) {
  const { provider, cfg, currency } = await loadConfig();
  if (provider === 'stripe') {
    const pi = await http(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}`, { headers: stripeHeaders(cfg) });
    const map = { succeeded: 'PAID', canceled: 'CANCELED', requires_payment_method: pi.last_payment_error ? 'FAILED' : 'PENDING' };
    return { status: map[pi.status] || 'PENDING', amount: fromMinor(pi.amount_received || pi.amount, pi.currency.toUpperCase()), currency: pi.currency.toUpperCase() };
  }
  const out = await http(`${squareBase(cfg)}/v2/terminals/checkouts/${encodeURIComponent(id)}`, { headers: squareHeaders(cfg) });
  const c = out.checkout;
  const map = { COMPLETED: 'PAID', CANCELED: 'CANCELED', CANCEL_REQUESTED: 'CANCELED' };
  return { status: map[c.status] || 'PENDING', amount: fromMinor(c.amount_money.amount, c.amount_money.currency), currency: c.amount_money.currency || currency };
}

async function cancel(id) {
  const { provider, cfg } = await loadConfig();
  if (provider === 'stripe') {
    await http(`https://api.stripe.com/v1/terminal/readers/${encodeURIComponent(cfg.readerId)}/cancel_action`, { method: 'POST', headers: stripeHeaders(cfg), body: '' });
  } else {
    await http(`${squareBase(cfg)}/v2/terminals/checkouts/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: squareHeaders(cfg), body: '{}' });
  }
}

module.exports = { startCharge, getStatus, cancel, toMinor };
