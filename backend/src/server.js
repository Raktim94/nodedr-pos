const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
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

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:1994';

// Behind the Next.js proxy we see its address; trust one hop so rate-limit
// and IP logging use the real client where a forwarded header is present.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false })); // CSP is served by the Next.js frontend
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Defense-in-depth: cap overall request volume per IP.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/print', printRoutes);
app.use('/api/masters', mastersRoutes);

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
  ensureFirewallRules();
});
