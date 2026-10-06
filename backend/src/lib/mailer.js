const nodemailer = require('nodemailer');
const prisma = require('./prisma');
const { decryptJson } = require('./secretBox');

// Builds a transport from the encrypted SMTP settings. Returns null when
// e-mail isn't configured — callers treat that as "feature off", not an error.
async function getTransport() {
  const s = await prisma.shopSettings.findFirst();
  const cfg = decryptJson(s?.smtpConfigEnc);
  if (!cfg?.host) return null;
  return {
    from: cfg.from || cfg.user,
    transport: nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port || 587,
      secure: Boolean(cfg.secure),
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      connectionTimeout: 10000,
      socketTimeout: 15000,
    }),
  };
}

async function sendMail({ to, subject, html, text }) {
  const t = await getTransport();
  if (!t) throw Object.assign(new Error('E-mail (SMTP) is not configured'), { status: 409 });
  await t.transport.sendMail({ from: t.from, to, subject, html, text });
}

module.exports = { sendMail };
