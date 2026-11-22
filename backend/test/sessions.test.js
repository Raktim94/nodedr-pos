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
