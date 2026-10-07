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

// Serves a fake "latest" package.json and a fake updater, and starts the backend pointed at both.
async function withFakes(latest, port, fn) {
  const seen = [];
  const meta = http.createServer((req, res) => res.end(JSON.stringify({ version: latest })));
  const upd = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end('{"status":"started"}');
    });
  });
  await Promise.all([meta, upd].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  process.env.UPDATE_CHECK_URL = `http://127.0.0.1:${meta.address().port}`;
  process.env.UPDATER_URL = `http://127.0.0.1:${upd.address().port}`;
  process.env.UPDATER_TOKEN = 'tok123';
  const srv = await startServer(port);
  try {
    await fn(await adminOn(srv), seen);
  } finally {
    srv.stop();
    meta.close();
    upd.close();
    delete process.env.UPDATE_CHECK_URL;
    delete process.env.UPDATER_URL;
    delete process.env.UPDATER_TOKEN;
  }
}

test('update API: newer version -> banner data, apply sends that exact version with the token', async () => {
  await withFakes('99.0.0', 4179, async (admin, seen) => {
    const st = (await admin.get('/api/update/status')).data;
    assert.equal(st.updateAvailable, true);
    assert.equal(st.latest, '99.0.0');
    assert.equal(st.canUpdate, true);
    const r = await admin.post('/api/update/apply', { confirmPassword: PW });
    assert.equal(r.status, 202, JSON.stringify(r.data));
    assert.deepEqual(seen, [{ method: 'POST', url: '/v1/update', auth: 'Bearer tok123', body: '{"version":"99.0.0"}' }]);
  });
});

test('update API: already latest -> no banner, apply refused', async () => {
  await withFakes('0.0.1', 4180, async (admin, seen) => {
    assert.equal((await admin.get('/api/update/status')).data.updateAvailable, false);
    assert.equal((await admin.post('/api/update/apply', { confirmPassword: PW })).status, 409);
    assert.equal(seen.length, 0);
  });
});

test('update API: unreachable updater is reported, not swallowed', async () => {
  const meta = http.createServer((req, res) => res.end('{"version":"99.0.0"}'));
  await new Promise((r) => meta.listen(0, '127.0.0.1', r));
  process.env.UPDATE_CHECK_URL = `http://127.0.0.1:${meta.address().port}`;
  process.env.UPDATER_URL = 'http://127.0.0.1:1';
  const srv = await startServer(4181);
  try {
    const admin = await adminOn(srv);
    const r = await admin.post('/api/update/apply', { confirmPassword: PW });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /updater/i);
    assert.equal((await admin.get('/api/update/progress')).data.state, 'unknown');
  } finally {
    srv.stop();
    meta.close();
    delete process.env.UPDATE_CHECK_URL;
    delete process.env.UPDATER_URL;
  }
});

// CasaOS can't use :latest, so its manifest pins exact image versions. Releasing
// code without bumping them is how an install ended up 6 weeks old — this
// makes that a failing test instead.
test('CasaOS manifest pins every image + listing version to the app version', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const v = require('../package.json').version;
  const manifest = fs.readFileSync(path.join(__dirname, '../../casaos/docker-compose.yml'), 'utf8');
  const images = [...manifest.matchAll(/image:\s*ghcr\.io\/raktim94\/(nodedr-pos-[a-z]+):(\S+)/g)];
  assert.deepEqual(images.map((m) => m[1]).sort(), ['nodedr-pos-backend', 'nodedr-pos-frontend', 'nodedr-pos-updater']);
  for (const [, name, tag] of images) assert.equal(tag, v, `${name} is pinned to ${tag}, app version is ${v} — bump casaos/docker-compose.yml`);
  assert.match(manifest, new RegExp(`^  version: "${v.replace(/\./g, '\\.')}"`, 'm'), 'x-casaos version must match package.json');
  assert.match(manifest, new RegExp(`^      ${v.replace(/\./g, '\\.')} \\(`, 'm'), 'add release notes for this version');
});
