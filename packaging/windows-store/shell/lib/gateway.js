// The single origin the app window talks to (http://127.0.0.1:<port>).
//
//   /api/*, /mcp     -> backend   (loopback, dynamic port)
//   everything else  -> Next.js   (loopback, dynamic port)
//
// This replaces the build-time `rewrites()` proxy in next.config.ts (whose
// destination is baked into the build and so cannot follow a dynamic port) and
// keeps the cookie/origin model identical to the Docker deployment. It also
// refuses requests whose Host header is not our own loopback address (DNS
// rebinding) and answers /__nodedr/ping with the per-launch nonce so the shell
// can prove it is talking to ITS server and not an unrelated service.
const http = require('http');
const net = require('net');

const isApiPath = (url) => /^\/(api|mcp)(\/|\?|$)/.test(url);

function proxy(req, res, port) {
  const up = http.request(
    { host: '127.0.0.1', port, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1' } },
    (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    }
  );
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'The NodeDR POS service is not responding.' }));
  });
  res.on('close', () => up.destroy());
  req.pipe(up);
}

function createGateway({ getBackendPort, getFrontendPort, nonce }) {
  let allowedHosts = new Set();
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts.has(host)) {
      res.writeHead(421, { 'content-type': 'text/plain' });
      return res.end('Misdirected request');
    }
    if (req.url === '/__nodedr/ping') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ app: 'nodedr-pos', nonce }));
    }
    proxy(req, res, isApiPath(req.url) ? getBackendPort() : getFrontendPort());
  });
  server.on('upgrade', (req, socket) => socket.destroy()); // no websockets are used
  return {
    server,
    /** Bind to the first free port in `candidates` (then any port). Loopback only. */
    async listen(candidates) {
      for (const p of [...candidates, 0]) {
        try {
          await new Promise((resolve, reject) => {
            const onErr = (e) => { server.off('listening', onOk); reject(e); };
            const onOk = () => { server.off('error', onErr); resolve(); };
            server.once('error', onErr);
            server.once('listening', onOk);
            server.listen(p, '127.0.0.1');
          });
          const port = server.address().port;
          allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
          return port;
        } catch (e) {
          if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e;
        }
      }
      throw new Error('no free local port');
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** Ask a port who it is. True only if our own nonce answers. */
function pingNonce(port, nonce, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/__nodedr/ping', timeout: timeoutMs, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => { try { resolve(JSON.parse(body).nonce === nonce); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** Is `port` currently bound by anything (on loopback)? Used to pick backend/frontend ports. */
function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

module.exports = { createGateway, pingNonce, freeLoopbackPort, isApiPath };
