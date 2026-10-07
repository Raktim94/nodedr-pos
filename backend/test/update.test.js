const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, client } = require('./helpers');
const { compareVersions } = require('../src/lib/update');

const PW = 'correct-horse-battery';

test('compareVersions orders semver numerically', () => {
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('1.2.0', '1.2.0') === 0);
  assert.ok(compareVersions('v1.2.1', '1.3.0') < 0);
  assert.equal(compareVersions('garbage', '1.0.0'), 0);
});

async function adminOn(srv) {
  const c = client(srv.base);
  await c.post('/api/auth/register', { name: 'Owner', email: 'o@example.com', password: PW });
  await c.post('/api/auth/login', { email: 'o@example.com', password: PW });
  return c;
}

test('update API: no updater configured -> status says canUpdate=false, apply is 501', async () => {
  delete process.env.UPDATER_URL;
  const srv = await startServer(4178);
  try {
    const anon = client(srv.base);
    assert.equal((await anon.get('/api/update/status')).status, 401);
    const admin = await adminOn(srv);
    const st = await admin.get('/api/update/status');
    assert.equal(st.status, 200);
    assert.equal(st.data.canUpdate, false);
    assert.match(st.data.current, /^\d+\.\d+\.\d+$/);
    assert.equal((await anon.get('/api/health')).data.version, st.data.current);
    assert.equal((await admin.post('/api/update/apply', {})).status, 401, 'needs password confirm');
    assert.equal((await admin.post('/api/update/apply', { confirmPassword: PW })).status, 501);
  } finally {
    srv.stop();
  }
});

test('update API: apply calls the updater with the bearer token and returns 202', async () => {
  const seen = [];
  const fake = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    setTimeout(() => res.end('{}'), 5000); // a real updater blocks while it pulls
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.UPDATER_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.UPDATER_TOKEN = 'tok123';
  const srv = await startServer(4179);
  try {
    const admin = await adminOn(srv);
    assert.equal((await admin.get('/api/update/status')).data.canUpdate, true);
    const r = await admin.post('/api/update/apply', { confirmPassword: PW });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    assert.deepEqual(seen, [{ method: 'POST', url: '/v1/update', auth: 'Bearer tok123' }]);
    assert.equal((await admin.post('/api/update/apply', { confirmPassword: PW })).status, 409, 'second click while running');
  } finally {
    srv.stop();
    fake.closeAllConnections();
    fake.close();
    delete process.env.UPDATER_URL;
    delete process.env.UPDATER_TOKEN;
  }
});

test('update API: unreachable updater is reported, not swallowed', async () => {
  process.env.UPDATER_URL = 'http://127.0.0.1:1';
  const srv = await startServer(4180);
  try {
    const admin = await adminOn(srv);
    const r = await admin.post('/api/update/apply', { confirmPassword: PW });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /updater/i);
  } finally {
    srv.stop();
    delete process.env.UPDATER_URL;
  }
});
