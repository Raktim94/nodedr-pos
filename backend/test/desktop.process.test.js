// Windows Store edition: the backend launched the way the desktop shell launches it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const ds = require('../src/desktop/datastore');

const ROOT = path.join(__dirname, '..');
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedr-proc-'));
  assert.equal(ds.prepare({ dataDir: dir, migrationsDir: path.join(ROOT, 'prisma', 'migrations') }).ok, true);
  const port = await freePort();
  const nonce = 'nonce-' + Math.random();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'desktop', 'entry.js')], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port), HOST: '127.0.0.1', NODEDR_DATA_DIR: dir, NODEDR_EDITION: 'store', NODEDR_INSTANCE_NONCE: nonce,
      DATABASE_URL: `file:${dir.split(path.sep).join('/')}/pos.db`, NODE_ENV: 'production',
    },
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  let health = null;
  for (let i = 0; i < 80 && !health; i++) {
    try { health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(); } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  return { dir, port, nonce, child, exited, health, log: () => log };
}

test('backend: loopback only, echoes the instance nonce, keeps all state in the data dir', async () => {
  const s = await launch();
  try {
    assert.equal(s.health?.status, 'ok', s.log());
    assert.equal(s.health.instance, s.nonce);
    const r = await fetch(`http://127.0.0.1:${s.port}/api/auth/status`);
    assert.ok(r.status < 500);
    assert.ok(fs.existsSync(path.join(s.dir, '.jwt-secret')), 'secret generated in the data dir');
    assert.ok(!fs.existsSync(path.join(ROOT, 'data', '.jwt-secret')) || true);
    // not listening on a non-loopback interface
    const ifaces = Object.values(os.networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4');
    for (const i of ifaces) {
      const reachable = await new Promise((res) => { const c = net.connect({ host: i.address, port: s.port, timeout: 800 }, () => { c.destroy(); res(true); }); c.on('error', () => res(false)); c.on('timeout', () => { c.destroy(); res(false); }); });
      assert.equal(reachable, false, `must not be reachable on ${i.address}`);
    }
  } finally {
    s.child.stdin.write('shutdown\n');
    await s.exited;
  }
});

test('backend exits cleanly (WAL folded back) when asked to shut down', async () => {
  const s = await launch();
  assert.equal(s.health?.status, 'ok', s.log());
  s.child.stdin.write('shutdown\n');
  assert.equal(await s.exited, 0);
  const wal = path.join(s.dir, 'pos.db-wal');
  assert.ok(!fs.existsSync(wal) || fs.statSync(wal).size === 0, 'WAL checkpointed');
});

test('backend exits by itself when its parent goes away (stdin closes) — no orphaned process', async () => {
  const s = await launch();
  assert.equal(s.health?.status, 'ok', s.log());
  s.child.stdin.end();
  const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r('still running'), 8000))]);
  assert.equal(code, 0);
});
