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
const announcementRoutes = require('./routes/announcements');
const purchasingRoutes = require('./routes/purchasing');
const emailReportRoutes = require('./routes/emailReports');
const { startScheduler } = require('./lib/scheduler');
const { requireApiKey } = require('./middleware/apiKeyAuth');
const { handleMcp } = require('./mcp/http');

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:1994';

// Behind the Next.js proxy we see its address; trust one hop so rate-limit
// and IP logging use the real client where a forwarded header is present.
app.set('trust proxy', 1);

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

// Defense-in-depth: cap overall request volume per IP.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Every /api/* response is dynamic and often auth-sensitive (login state,
// stock levels, prices, invoices) — none of it may ever be cached by the
// browser or an intermediate proxy. Without this, a route like GET
// /auth/status only had an Express-auto-generated ETag and no
// Cache-Control at all, which per HTTP caching rules leaves a browser free
// to serve an old cached response with ZERO network round-trip — e.g. a
// stale "onboarded: true" reappearing right after the app's onboarding
// state actually changed back to false. Added while investigating a
// report of exactly that shape ("reach onboarding, then instantly bounce
// to sign-in"); every attempt to reproduce it cleanly in this session
// traced back to stale test data instead, so this is a real gap being
// closed on general principle, not a confirmed root cause of that report.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: require('../package.json').version }));

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

app.listen(PORT, () => {
  console.log(`nodedr-pos backend listening on port ${PORT}`);
  startScheduler();
  startSync();
  ensureFirewallRules();
});
