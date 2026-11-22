const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

// The client address comes from X-Forwarded-For, which a caller can set. Limits
// that must hold regardless (password guessing, signed webhooks) cannot depend on it.
test('login attempts are limited per account even when every request claims a different address', async () => {
  const srv = await startServer(0);
  try {
    const pub = client(srv.base);
    let last;
    for (let i = 0; i < 12; i++) {
      last = await pub.post('/api/auth/login', { email: 'victim@example.com', password: 'wrong-password' }, { 'x-forwarded-for': `203.0.113.${i + 1}` });
    }
    assert.equal(last.status, 429);
  } finally {
    srv.stop();
  }
});

test('webhooks are not throttled by address: unsigned floods get 401, never 429', async () => {
  const srv = await startServer(0);
  try {
    const pub = client(srv.base);
    let last;
    for (let i = 0; i < 320; i++) last = await pub.raw('/api/webhooks/woocommerce/1', '{}', 'application/json', { 'x-forwarded-for': '203.0.113.9' });
    assert.equal(last.status, 401);
  } finally {
    srv.stop();
  }
});

test('a card-terminal payment can pay for one bill only (unique index on Invoice.paymentRef)', async () => {
  const srv = await startServer(0);
  try {
    const Database = require('better-sqlite3');
    const db = new Database(srv.dbPath, { readonly: true });
    const idx = db.prepare("PRAGMA index_list('Invoice')").all();
    const cols = (name) => db.prepare(`PRAGMA index_info('${name}')`).all().map((c) => c.name);
    const hasUniquePaymentRef = idx.some((i) => i.unique === 1 && cols(i.name).join() === 'paymentRef');
    db.close();
    assert.ok(hasUniquePaymentRef);
  } finally {
    srv.stop();
  }
});
