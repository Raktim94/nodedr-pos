const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

// Behind Next.js (and Caddy or a tunnel in front of it) the client's address
// arrives in X-Forwarded-For. Rate limits must see the real client, which is
// only true when TRUST_PROXY_HOPS matches the number of proxies in front.
async function overLimitFor(env, forwardedFor) {
  const srv = await startServer(0, env);
  try {
    const pub = client(srv.base);
    const hit = (xff) => pub.raw('/api/webhooks/woocommerce/1', '{}', 'application/json', { 'x-forwarded-for': xff });
    for (let i = 0; i < 65; i++) await hit(forwardedFor('203.0.113.9')); // one noisy visitor
    return (await hit(forwardedFor('198.51.100.7'))).status === 429; // a different visitor
  } finally {
    srv.stop();
  }
}

test('one proxy hop: behind a second proxy every visitor shares one rate-limit bucket', async () => {
  // Frontend sees the visitor via the front proxy: "visitor, front-proxy".
  assert.equal(await overLimitFor({ TRUST_PROXY_HOPS: '1' }, (visitor) => `${visitor}, 10.0.0.2`), true);
});

test('two proxy hops: each visitor keeps their own bucket', async () => {
  assert.equal(await overLimitFor({ TRUST_PROXY_HOPS: '2' }, (visitor) => `${visitor}, 10.0.0.2`), false);
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
