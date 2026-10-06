// Spins up the real backend against a throwaway SQLite file for API tests.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function startServer(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedr-test-'));
  const env = { ...process.env, DATABASE_URL: `file:${path.join(dir, 't.db')}`, PORT: String(port), JWT_SECRET: 'test-secret-test-secret-test-secret', NODE_ENV: 'test' };
  execFileSync(process.execPath, ['node_modules/.bin/prisma', 'migrate', 'deploy'], { env, cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  const child = spawn(process.execPath, ['src/server.js'], { env, cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    base,
    log: () => log,
    stop: () => {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Minimal cookie-jar client.
function client(base) {
  let cookie = '';
  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  return { get: (u, h) => call('GET', u, undefined, h), post: (u, b, h) => call('POST', u, b, h), put: (u, b, h) => call('PUT', u, b, h), patch: (u, b, h) => call('PATCH', u, b, h), del: (u, b, h) => call('DELETE', u, b, h) };
}

module.exports = { startServer, client };
