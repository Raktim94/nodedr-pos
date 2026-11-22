const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

let srv;
let admin;
const PW = 'correct-horse-battery';

test.before(async () => {
  srv = await startServer(4177);
  admin = client(srv.base);
  assert.equal((await admin.post('/api/auth/register', { name: 'Owner', email: 'o@example.com', password: PW })).status, 201);
  assert.equal((await admin.post('/api/auth/login', { email: 'o@example.com', password: PW })).status, 200);
});
test.after(() => srv?.stop());

test('sessions end everywhere when the password changes; the changing session continues', async () => {
  const mk = await admin.post('/api/auth/users', { name: 'Sess', email: 'sess@example.com', password: 'first-pass-1', role: 'cashier', permissions: [], confirmPassword: PW });
  assert.equal(mk.status, 201, JSON.stringify(mk.data));
  const a = client(srv.base);
  const b = client(srv.base);
  assert.equal((await a.post('/api/auth/login', { email: 'sess@example.com', password: 'first-pass-1' })).status, 200);
  assert.equal((await b.post('/api/auth/login', { email: 'sess@example.com', password: 'first-pass-1' })).status, 200);
  assert.equal((await a.post('/api/auth/change-password', { currentPassword: 'first-pass-1', newPassword: 'second-pass-2' })).status, 204);
  assert.equal((await b.get('/api/products')).status, 401);
  assert.equal((await a.get('/api/products')).status, 200);
  // An admin reset ends the user's sessions too.
  assert.equal((await admin.put(`/api/auth/users/${mk.data.id}`, { password: 'third-pass-3', confirmPassword: PW })).status, 200);
  assert.equal((await a.get('/api/products')).status, 401);
});

test('a disabled account loses its settings view and stays logged out after re-enabling', async () => {
  const mk = await admin.post('/api/auth/users', { name: 'Gone', email: 'gone@example.com', password: 'gone-pass-1', role: 'cashier', permissions: [], confirmPassword: PW });
  assert.equal(mk.status, 201, JSON.stringify(mk.data));
  const c = client(srv.base);
  assert.equal((await c.post('/api/auth/login', { email: 'gone@example.com', password: 'gone-pass-1' })).status, 200);
  assert.equal((await admin.post('/api/settings', { shopName: 'S', address1: 'a', gstEnabled: false })).status, 201);
  const view = async () => (await c.get('/api/settings')).data;
  const anon = Object.keys((await client(srv.base).get('/api/settings')).data).length;
  assert.ok(Object.keys(await view()).length > anon, 'a signed-in user sees more than an anonymous visitor');
  assert.equal((await admin.put(`/api/auth/users/${mk.data.id}`, { active: false, confirmPassword: PW })).status, 200);
  assert.equal(Object.keys(await view()).length, anon, 'disabled account sees only the anonymous view');
  assert.equal((await admin.put(`/api/auth/users/${mk.data.id}`, { active: true, confirmPassword: PW })).status, 200);
  assert.equal((await c.get('/api/products')).status, 401, 'old cookie stays dead after re-enabling');
});

test('VERI*FACTU settings, certificate upload and exchange rates need the password re-entered', async () => {
  const noPw = [
    await admin.put('/api/verifactu/settings', { enabled: false }),
    await admin.put('/api/payments/fx', { rates: { USD: 83 } }),
  ];
  for (const r of noPw) assert.equal(r.status, 401);
  assert.equal(noPw[0].data.code, 'PASSWORD_CONFIRM_REQUIRED');
  const form = new FormData();
  form.append('file', new Blob(['x']), 'c.p12');
  const cert = await fetch(`${srv.base}/api/verifactu/certificate`, { method: 'POST', headers: { cookie: await admin.cookie() }, body: form });
  assert.equal(cert.status, 401);
  // With the password the request reaches the real handler (it may still fail on its own merits, but not with 401).
  assert.notEqual((await admin.put('/api/verifactu/settings', { enabled: false, confirmPassword: PW })).status, 401);
  assert.equal((await admin.put('/api/payments/fx', { rates: { USD: 83 }, confirmPassword: PW })).status, 200);
});
