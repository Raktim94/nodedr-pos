const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { packageFamilyFromPath, resolveDataDir } = require('../lib/paths');
const { makeRedactor } = require('../lib/redact');
const { createGateway, pingNonce, freeLoopbackPort } = require('../lib/gateway');
const { startChild, waitUntil } = require('../lib/supervisor');
const settings = require('../lib/settings');
const { buildReport } = require('../lib/diagnostics');

const WATCHDOG = path.join(__dirname, '..', '..', '..', '..', 'backend', 'src', 'desktop', 'watchdog.js');

test('package family is derived from the WindowsApps install path', () => {
  assert.equal(
    packageFamilyFromPath('C:\\Program Files\\WindowsApps\\12345Nodedr.POS_1.6.2.0_x64__8wekyb3d8bbwe\\NodeDRPOS.exe'),
    '12345Nodedr.POS_8wekyb3d8bbwe'
  );
  assert.equal(packageFamilyFromPath('C:\\Users\\a\\NodeDRPOS\\NodeDRPOS.exe'), null);
});

test('data dir: LocalState of the package when packaged, plain per-user folder otherwise, override wins', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };
  const pk = resolveDataDir({ env, platform: 'win32', execPath: 'C:\\Program Files\\WindowsApps\\X.POS_1.0.0.0_x64__abc123\\NodeDRPOS.exe' });
  assert.equal(pk.dir, 'C:\\Users\\a\\AppData\\Local\\Packages\\X.POS_abc123\\LocalState\\NodeDRPOS');
  assert.equal(pk.kind, 'package');
  assert.ok(!/WindowsApps\\X/.test(pk.dir.replace('Packages', '')), 'never inside the install dir');
  const un = resolveDataDir({ env, platform: 'win32', execPath: 'C:\\dev\\NodeDRPOS.exe' });
  assert.equal(un.dir, 'C:\\Users\\a\\AppData\\Local\\NodeDRPOS');
  assert.equal(resolveDataDir({ env: { NODEDR_DATA_DIR: os.tmpdir() }, platform: 'win32', execPath: 'x' }).kind, 'override');
});

test('redaction removes secrets, tokens, cookies and JWTs', () => {
  const r = makeRedactor(['supersecretvalue123']);
  const out = r('boot supersecretvalue123 Authorization: Bearer abc.def password=hunter2 set-cookie: sid=XYZ eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4');
  for (const leak of ['supersecretvalue123', 'abc.def', 'hunter2', 'sid=XYZ', 'eyJhbGciOiJIUzI1']) assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`);
});

test('support report contains versions and paths but no secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-rep-'));
  fs.mkdirSync(path.join(dir, 'logs'));
  fs.writeFileSync(path.join(dir, 'logs', 'shell.log'), 'ok line\npassword=hunter2\n');
  const redact = makeRedactor(['nonce-nonce-nonce']);
  const rep = buildReport({ appVersion: '1.6.2', dataDir: dir, dataKind: 'package', packageFamily: 'P_x', logDir: path.join(dir, 'logs'), ports: { gateway: 1 }, state: 'error', error: { code: 'X', message: 'boom' }, redact });
  assert.match(rep, /NodeDR POS 1\.6\.2/);
  assert.ok(rep.includes(dir));
  assert.ok(!rep.includes('hunter2'));
});

async function fakeServer(handler) {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
}
const get = (port, p, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method: headers.__method || 'GET', headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
  });
  req.on('error', reject);
  if (headers.__body) req.write(headers.__body);
  req.end();
});

test('gateway: /api and /mcp go to the backend, the rest to the frontend, POST bodies and cookies pass through', async () => {
  const be = await fakeServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { res.setHeader('set-cookie', 'sid=1; Path=/'); res.end(`BE ${req.method} ${req.url} ${b}`); }); });
  const fe = await fakeServer((req, res) => res.end(`FE ${req.url}`));
  const gw = createGateway({ getBackendPort: () => be.address().port, getFrontendPort: () => fe.address().port, nonce: 'n1' });
  const port = await gw.listen([0]);
  try {
    assert.equal((await get(port, '/pos')).body, 'FE /pos');
    assert.equal((await get(port, '/api/health')).body, 'BE GET /api/health ');
    assert.equal((await get(port, '/mcp', { __method: 'POST', __body: '{"a":1}', 'content-length': '7' })).body, 'BE POST /mcp {"a":1}');
    assert.equal((await get(port, '/apix')).body, 'FE /apix');
    assert.match((await get(port, '/api/x')).headers['set-cookie'][0], /sid=1/);
  } finally { await gw.close(); be.close(); fe.close(); }
});

test('gateway: refuses foreign Host headers (DNS rebinding) and proves identity with the nonce', async () => {
  const gw = createGateway({ getBackendPort: () => 1, getFrontendPort: () => 1, nonce: 'abc' });
  const port = await gw.listen([0]);
  try {
    assert.equal((await get(port, '/', { host: 'evil.example.com' })).status, 421);
    assert.equal((await get(port, '/', { host: `localhost:${port}` })).status !== 421, true);
    assert.equal(await pingNonce(port, 'abc'), true);
    assert.equal(await pingNonce(port, 'different'), false);
  } finally { await gw.close(); }
});

test('gateway: never accepts an unrelated service on a busy preferred port — it moves to another port', async () => {
  const squatter = await fakeServer((req, res) => res.end('{"nonce":"abc"}')); // even one that lies
  const busy = squatter.address().port;
  const gw = createGateway({ getBackendPort: () => 1, getFrontendPort: () => 1, nonce: 'abc' });
  const port = await gw.listen([busy]);
  try {
    assert.notEqual(port, busy);
    assert.equal(await pingNonce(port, 'abc'), true);
  } finally { await gw.close(); squatter.close(); }
});

test('gateway: a down upstream gives a clean 502, not a hang or crash', async () => {
  const dead = await freeLoopbackPort();
  const gw = createGateway({ getBackendPort: () => dead, getFrontendPort: () => dead, nonce: 'n' });
  const port = await gw.listen([0]);
  try { assert.equal((await get(port, '/api/x')).status, 502); } finally { await gw.close(); }
});

const childScript = `
  require(${JSON.stringify(WATCHDOG)});
  global.__nodedrShutdownHook = () => console.log('graceful-hook');
  setInterval(()=>{}, 1000); console.log('up');
`;
const mk = (extra = {}) => startChild({ name: 't', command: process.execPath, args: ['-e', childScript], cwd: os.tmpdir(), env: process.env, sink: { write: (d) => (extra.out = (extra.out || '') + d) }, ...extra });

test('supervisor: graceful stop runs the shutdown hook and exits 0', async () => {
  const out = {};
  const c = mk(out);
  await waitUntil(() => /up/.test(out.out || ''), { timeoutMs: 5000, intervalMs: 50 });
  const info = await c.stop(5000);
  assert.equal(info.code, 0);
  assert.match(out.out, /graceful-hook/);
});

test('supervisor: a child that ignores shutdown is force-killed after the grace period', async () => {
  const c = startChild({ name: 'stuck', command: process.execPath, args: ['-e', 'process.stdin.on("data",()=>{}); setInterval(()=>{},1000)'], cwd: os.tmpdir(), env: process.env });
  await new Promise((r) => setTimeout(r, 300));
  await c.stop(300);
  assert.equal(c.exited, true);
});

test('watchdog: child exits on its own when the parent (stdin pipe) disappears', async () => {
  // A parent node process spawns the child, reports the child pid, then is killed hard.
  const parent = spawn(process.execPath, ['-e', `
    const { spawn } = require('child_process');
    const c = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: ['pipe','ignore','ignore'] });
    console.log(c.pid);
    setInterval(()=>{}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  const pid = Number(await new Promise((r) => parent.stdout.once('data', (d) => r(String(d).trim()))));
  await new Promise((r) => setTimeout(r, 400));
  const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
  assert.equal(alive(pid), true);
  parent.kill('SIGKILL');
  const gone = await waitUntil(() => !alive(pid), { timeoutMs: 8000, intervalMs: 100 });
  assert.equal(gone.ok, true, 'child must not outlive its parent');
});

test('waitUntil: times out with a reason, and stops early when the process died', async () => {
  assert.deepEqual((await waitUntil(() => false, { timeoutMs: 200, intervalMs: 50 })).reason, 'timeout');
  assert.deepEqual((await waitUntil(() => false, { timeoutMs: 5000, intervalMs: 50, isAlive: () => false })).reason, 'exited');
});

test('window bounds: restored only when still visible on a connected display', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  assert.ok(settings.visibleBounds({ x: 100, y: 50, width: 1200, height: 800 }, displays));
  assert.equal(settings.visibleBounds({ x: 5000, y: 50, width: 1200, height: 800 }, displays), null);
  assert.equal(settings.visibleBounds({ x: 0, y: 0, width: 100, height: 100 }, displays), null);
});
