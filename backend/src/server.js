const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { execFile } = require('child_process');

const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const productRoutes = require('./routes/products');
const customerRoutes = require('./routes/customers');
const invoiceRoutes = require('./routes/invoices');
const returnRoutes = require('./routes/returns');
const printRoutes = require('./routes/print');
const mastersRoutes = require('./routes/masters');
const apiKeyRoutes = require('./routes/apiKeys');
const updateRoutes = require('./routes/update');
const externalRoutes = require('./routes/external');
const warrantyRoutes = require('./routes/warranty');
const signatureRoutes = require('./routes/signatures');
const publicRoutes = require('./routes/public');
const shiftRoutes = require('./routes/shifts');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');
const integrationRoutes = require('./routes/integrations');
const hubRoutes = require('./routes/hub');
const { startSync } = require('./lib/sync');
const orderRoutes = require('./routes/orders');
const displayRoutes = require('./routes/display');
const announcementRoutes = require('./routes/announcements');
const purchasingRoutes = require('./routes/purchasing');
const emailReportRoutes = require('./routes/emailReports');
const { startScheduler } = require('./lib/scheduler');
const { startSubmitter } = require('./lib/verifactu/service');
const verifactuRoutes = require('./routes/verifactu');
const { requireApiKey } = require('./middleware/apiKeyAuth');
const { handleMcp } = require('./mcp/http');

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:1994';

// Behind the Next.js proxy we see its address; trust one hop so rate-limit
// and IP logging use the real client where a forwarded header is present.
// Next.js passes a client-supplied X-Forwarded-For through unchanged, so with
// no proxy in front the address is whatever the caller claims; behind Caddy
// (which overwrites an untrusted header) it is the real client. Per-address
// limits are therefore best effort. Only raise TRUST_PROXY_HOPS if every extra
// hop is a proxy of yours that overwrites the header.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
app.set('trust proxy', Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 1);

app.use(helmet({ contentSecurityPolicy: false })); // CSP is served by the Next.js frontend
app.use(compression()); // JSON/CSV shrink ~80%; PDFs are already compressed and skipped by the filter
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(cookieParser());
// Keep the exact received bytes for signed-webhook routes only — HMACs are
// computed over the raw body, and buffering it everywhere would waste memory.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      if (req.url.startsWith('/api/webhooks/')) req.rawBody = buf;
    },
  })
);

// Defense-in-depth: cap overall request volume per IP. Best effort only — the
// address is as honest as the proxy in front (see TRUST_PROXY_HOPS), so the
// login also has a per-account limit, and signed webhooks are not limited by
// address at all (the signature is their gate).
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/api/webhooks/'),
  })
);

// /api responses are dynamic and often auth-sensitive; without Cache-Control a
// browser may reuse an ETag-only response with no round-trip.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// `instance` echoes a per-launch nonce (Windows Store edition) so the desktop
// shell can prove the process answering on a port is the one it started, not
// an unrelated service that happened to hold the port.
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', version: require('../package.json').version, ...(process.env.NODEDR_INSTANCE_NONCE ? { instance: process.env.NODEDR_INSTANCE_NONCE } : {}) })
);

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/update', updateRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/print', printRoutes);
app.use('/api/masters', mastersRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/external', externalRoutes);
app.use('/api/warranty', warrantyRoutes);
app.use('/api/signatures', signatureRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/email-reports', emailReportRoutes);
app.use('/api/purchasing', purchasingRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/hub', hubRoutes.ingest);
app.use('/api/hub', hubRoutes.views);
app.use('/api/sync', hubRoutes.cfg);
app.use('/api/integrations', integrationRoutes.admin);
app.use('/api/webhooks', integrationRoutes.hook);
app.use('/api/announcements', announcementRoutes);
app.use('/api/display', displayRoutes);
app.use('/api/verifactu', verifactuRoutes);

// MCP over Streamable HTTP — authenticated with an API key (Bearer), tools
// limited to that key's scopes. Same rate budget as the External API.
app.post(
  '/mcp',
  rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }),
  requireApiKey(),
  handleMcp
);
app.all('/mcp', (req, res) => res.status(405).json({ error: 'Use POST' }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// MSIX packages have no manifest-level equivalent of the NSIS/EXE installer's
// `netsh advfirewall` calls (which run once, at install time, under the
// installer's own elevation). Under MSIX, opt in via MANAGE_FIREWALL=1 (set
// only in the MSIX packaged-service env, never in Docker/Debian/dev/the EXE
// install, which already gets its rules from nodedr-pos.nsi) and this
// service — which already runs as LocalSystem, so no new elevation is
// needed — registers the same two rules the installer would have, on every
// startup. Delete-then-add makes it idempotent; failures are logged, never
// fatal, since the POS must still work with the firewall left at its
// previous state.
function ensureFirewallRules() {
  if (process.platform !== 'win32' || process.env.MANAGE_FIREWALL !== '1') return;

  const frontendPort = process.env.FRONTEND_PORT || '1994';
  const rules = [
    { name: 'NodeDR POS Web', action: 'allow', port: frontendPort, extra: ['profile=private,domain'] },
    { name: 'NodeDR POS API (internal only)', action: 'block', port: String(PORT), extra: [] },
  ];

  for (const rule of rules) {
    execFile('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${rule.name}`], () => {
      const addArgs = [
        'advfirewall', 'firewall', 'add', 'rule',
        `name=${rule.name}`, 'dir=in', `action=${rule.action}`, 'protocol=TCP', `localport=${rule.port}`,
        ...rule.extra,
      ];
      execFile('netsh', addArgs, (err) => {
        if (err) console.error(`firewall rule "${rule.name}" could not be added: ${err.message}`);
      });
    });
  }
}

// HOST pins the listener to one interface. Unset (Docker, CasaOS, dev) keeps
// the historical all-interfaces behaviour; the Windows Store edition sets
// 127.0.0.1 so the API is never reachable from the network.
const listenArgs = process.env.HOST ? [PORT, process.env.HOST] : [PORT];
app.listen(...listenArgs, () => {
  console.log(`nodedr-pos backend listening on ${process.env.HOST || '0.0.0.0'}:${PORT}`);
  startScheduler();
  startSubmitter();
  startSync();
  ensureFirewallRules();
});
