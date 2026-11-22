// Spain VERI*FACTU for NODEDR POS: builds the append-only, hash-chained fiscal record for every sale and every
// return inside the same database transaction, and reports the records to AEAT in the background. Implemented,
// not certified: see docs/verifactu.md for what remains (the producer's Declaracion Responsable and a run
// against AEAT's pre-production portal).
const crypto = require('crypto');
const prisma = require('../prisma');
const { encrypt, decrypt } = require('../secretBox');
const dom = require('./domain');
const aeat = require('./aeat');

const { getSettings: loadShop } = require('../settings');
const { httpError } = require('../http');
const { SPAIN_CURRENCY, verifactuActive } = require('../region');
const BATCH = 100;
const RETRY_MS = 5 * 60_000;
const cents = (n) => Math.round((Number(n) + Number.EPSILON) * 100);

// ---- producer identity (a legal fact only the software producer can supply) ----
function producer() {
  const get = (k, d) => (process.env[k] || '').trim() || d;
  return {
    name: get('VERIFACTU_PRODUCER_NAME', 'NODEDR INFOTECH PRIVATE LIMITED'),
    country: get('VERIFACTU_PRODUCER_COUNTRY', 'IN'),
    idType: get('VERIFACTU_PRODUCER_ID_TYPE', '04'),
    id: get('VERIFACTU_PRODUCER_ID', ''),
    systemId: get('VERIFACTU_SYSTEM_ID', 'NP'),
    version: get('APP_VERSION', require('../../../package.json').version),
  };
}

function systemInfo(installationNumber) {
  const p = producer();
  return {
    producerName: p.name,
    producerCountry: p.country,
    producerIdType: p.idType,
    producerId: p.id,
    systemName: 'NODEDR POS',
    systemId: p.systemId,
    version: p.version,
    installationNumber,
  };
}

/** Why this shop cannot issue VERI*FACTU records yet, in plain words. */
function problems(shop) {
  const out = [];
  if (shop.currencyCode !== SPAIN_CURRENCY) out.push(`Set the shop currency to ${SPAIN_CURRENCY}.`);
  if (!shop.gstEnabled) out.push('Turn tax on (Settings > Tax) and give every product its IVA rate.');
  if ((shop.vfNif || '').trim().length !== 9) out.push('Enter the shop NIF/CIF (9 characters).');
  if (!(shop.legalName || shop.shopName || '').trim()) out.push('Enter the shop legal name.');
  const p = producer();
  if (!p.id || p.id.length > 20 || p.systemId.length !== 2) {
    out.push('The server operator must set VERIFACTU_PRODUCER_ID (the producer identifier, at most 20 characters) and a 2-character VERIFACTU_SYSTEM_ID.');
  }
  return out;
}

const issuerName = (shop) => (shop.legalName || shop.shopName).trim();
const issuerNif = (shop) => (shop.vfNif || '').trim().toUpperCase();

async function getSettings() {
  const shop = await loadShop();
  if (!shop) throw httpError('Shop settings not configured');
  const grouped = await prisma.verifactuRecord.groupBy({ by: ['status'], _count: { _all: true } });
  return {
    enabled: shop.vfEnabled,
    environment: shop.vfEnvironment,
    nif: shop.vfNif || '',
    series: shop.vfSeries,
    nextNumber: shop.vfNextNumber,
    hasCertificate: !!shop.vfCertEnc,
    certSubject: shop.vfCertSubject,
    certExpires: shop.vfCertExpires,
    problems: problems(shop),
    counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
    status: 'implemented-not-certified',
  };
}

async function saveSettings(dto) {
  const shop = await loadShop();
  if (!shop) throw httpError('Shop settings not configured');
  const series = String(dto.series ?? shop.vfSeries).trim();
  if (!/^[A-Za-z0-9-]{1,12}$/.test(series)) throw httpError('The invoice series may use letters, digits and "-" (at most 12 characters).');
  const nif = String(dto.nif ?? shop.vfNif ?? '').trim().toUpperCase();
  const environment = dto.environment === 'PRODUCTION' ? 'PRODUCTION' : 'TEST';
  const next = { ...shop, vfNif: nif, vfSeries: series };
  if (dto.enabled) {
    const p = problems(next);
    if (p.length) throw httpError(p.join(' '));
  }
  const used = await prisma.verifactuRecord.count();
  if (used > 0 && (series !== shop.vfSeries || (shop.vfNif && nif !== shop.vfNif))) {
    throw httpError('The series and the NIF cannot change once records exist; the numbering would restart.', 409);
  }
  await prisma.shopSettings.update({
    where: { id: shop.id },
    data: {
      vfEnabled: !!dto.enabled,
      vfEnvironment: environment,
      vfNif: nif || null,
      vfSeries: series,
      vfInstallation: shop.vfInstallation || crypto.randomUUID(),
    },
  });
  return getSettings();
}

async function uploadCertificate(file, password) {
  if (!password) throw httpError('Enter the certificate password.');
  let info;
  try {
    info = aeat.inspectCertificate(file, password);
  } catch (e) {
    throw httpError(e.message);
  }
  if (info.expiresAt.getTime() < Date.now()) throw httpError('This certificate has expired.');
  const shop = await loadShop();
  if (!shop) throw httpError('Shop settings not configured');
  await prisma.shopSettings.update({
    where: { id: shop.id },
    data: {
      vfCertEnc: encrypt(file.toString('base64')),
      vfCertPassEnc: encrypt(password),
      vfCertSubject: info.subject.slice(0, 300),
      vfCertExpires: info.expiresAt,
      vfInstallation: shop.vfInstallation || crypto.randomUUID(),
    },
  });
  return getSettings();
}

// ---- record creation (called inside the checkout / return transaction) ----
async function append(tx, shop, a) {
  const nif = issuerNif(shop);
  const environment = shop.vfEnvironment;
  const { day, timestamp } = dom.madridParts(a.now || new Date());
  const last = await tx.verifactuRecord.findFirst({ where: { issuerNif: nif, environment }, orderBy: { seq: 'desc' } });
  const previous = last
    ? { issuerNif: last.issuerNif, number: last.invoiceNumber, issueDate: last.issueDate, hash: last.hash }
    : null;
  let b;
  try {
    b = dom.buildBreakdown(a.lines, a.targetCents);
  } catch (e) {
    throw httpError(e.message);
  }
  const id = { issuerNif: nif, number: a.number, issueDate: day };
  const rec = {
    id,
    issuerName: issuerName(shop),
    invoiceType: a.invoiceType,
    description: a.description,
    breakdown: b.breakdown,
    taxTotalCents: b.taxTotalCents,
    totalCents: b.totalCents,
    previous,
    system: systemInfo(shop.vfInstallation || ''),
    generatedAt: timestamp,
    rectified: a.rectified,
  };
  try {
    dom.validateAlta(rec);
  } catch (e) {
    throw httpError(e.message);
  }
  return tx.verifactuRecord.create({
    data: {
      issuerNif: nif,
      environment,
      seq: (last?.seq ?? 0) + 1,
      type: 'ALTA',
      invoiceType: a.invoiceType,
      invoiceNumber: a.number,
      issueDate: day,
      taxTotalCents: b.taxTotalCents,
      totalCents: b.totalCents,
      generatedAt: timestamp,
      previousHash: previous?.hash ?? null,
      hash: dom.altaHash(rec),
      xml: dom.altaXml(rec),
      qrUrl: dom.qrUrl(environment, id, b.totalCents),
      invoiceId: a.invoiceId ?? null,
      returnId: a.returnId ?? null,
    },
  });
}

async function takeNumber(tx, shop, refund) {
  const field = refund ? 'vfNextRefundNumber' : 'vfNextNumber';
  const updated = await tx.shopSettings.update({ where: { id: shop.id }, data: { [field]: { increment: 1 } } });
  const n = String(updated[field] - 1).padStart(6, '0');
  return refund ? `R${shop.vfSeries}-${n}` : `${shop.vfSeries}-${n}`;
}

function assertReady(shop) {
  const p = problems(shop);
  if (p.length) throw httpError(`VERI*FACTU is on but not ready: ${p.join(' ')}`);
}

/**
 * Records a sale as a simplified invoice (F2). A no-op when VERI*FACTU is off, or when the bill has no goods
 * (a pure return or a due payment) or totals nothing. Throws, rolling the sale back, when the record cannot be
 * produced: a sale must not be issued without its fiscal record.
 */
async function recordSale(tx, shop, invoice) {
  // Spain only (euro shops): any other currency never records, even if the switch was left on.
  if (!verifactuActive(shop)) return null;
  if (!invoice.items?.length || !(invoice.totalAmount > 0)) return null;
  assertReady(shop);
  const dup = await tx.verifactuRecord.findFirst({ where: { invoiceId: invoice.id, invoiceType: 'F2' } });
  if (dup) return dup;
  return append(tx, shop, {
    invoiceType: 'F2',
    number: await takeNumber(tx, shop, false),
    description: 'Venta de mercancías',
    lines: invoice.items.map((it) => ({ grossCents: cents(it.total), ratePercent: Number(it.taxRate) })),
    targetCents: cents(invoice.totalAmount),
    invoiceId: invoice.id,
  });
}

/**
 * Records a return as a corrective simplified invoice (R5, by difference, negative amounts) of the original
 * sale. `ret` is the created Return with its items; `originalItems` are the original invoice's lines.
 */
async function recordReturn(tx, shop, ret, originalItems) {
  if (!verifactuActive(shop)) return null;
  const original = await tx.verifactuRecord.findFirst({
    where: { invoiceId: ret.invoiceId, invoiceType: 'F2', environment: shop.vfEnvironment },
  });
  if (!original) return null; // the sale predates VERI*FACTU: there is no invoice to rectify
  const byId = new Map(originalItems.map((i) => [i.id, i]));
  const lines = ret.items
    .map((ri) => ({ grossCents: cents(ri.refundAmount), ratePercent: Number(byId.get(ri.invoiceItemId)?.taxRate ?? 0) }))
    .filter((l) => l.grossCents > 0);
  if (lines.length === 0) return null;
  assertReady(shop);
  return append(tx, shop, {
    invoiceType: 'R5',
    number: await takeNumber(tx, shop, true),
    description: 'Devolución de mercancías',
    lines,
    targetCents: -cents(ret.totalRefund),
    invoiceId: ret.invoiceId,
    returnId: ret.id,
    rectified: [{ issuerNif: original.issuerNif, number: original.invoiceNumber, issueDate: original.issueDate }],
  });
}

/** The QR block printed on a paid receipt, or null when the sale has no VERI*FACTU invoice. */
async function qrForInvoice(invoiceId) {
  const rec = await prisma.verifactuRecord.findFirst({
    where: { invoiceId, invoiceType: 'F2', qrUrl: { not: null } },
    orderBy: { seq: 'asc' },
  });
  if (!rec?.qrUrl) return null;
  return { url: rec.qrUrl, heading: dom.QR_HEADING, legend: dom.QR_VERIFIABLE, short: dom.QR_SHORT, invoiceNumber: rec.invoiceNumber };
}

/** Returns the invoice with `verifactu` attached for the print builders. */
async function withQr(invoice) {
  if (!invoice) return invoice;
  return { ...invoice, verifactu: await qrForInvoice(invoice.id) };
}

// ---- listing, verification, export ----
async function records(take = 50, skip = 0) {
  const [items, total] = await Promise.all([
    prisma.verifactuRecord.findMany({
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
      skip,
      select: {
        id: true, seq: true, invoiceType: true, invoiceNumber: true, issueDate: true, totalCents: true, taxTotalCents: true,
        hash: true, status: true, attempts: true, csv: true, errorCode: true, errorText: true, submittedAt: true,
        environment: true, invoiceId: true,
      },
    }),
    prisma.verifactuRecord.count(),
  ]);
  return { items, total };
}

function rehash(r) {
  return dom.altaHash({
    id: { issuerNif: r.issuerNif, number: r.invoiceNumber, issueDate: r.issueDate },
    invoiceType: r.invoiceType,
    taxTotalCents: r.taxTotalCents,
    totalCents: r.totalCents,
    previous: r.previousHash ? { hash: r.previousHash } : null,
    generatedAt: r.generatedAt,
  });
}

/** Recomputes every hash and link of every chain from the stored fields. */
async function verifyChain() {
  let checked = 0;
  const chains = await prisma.verifactuRecord.findMany({ distinct: ['issuerNif', 'environment'], select: { issuerNif: true, environment: true } });
  for (const c of chains) {
    const recs = await prisma.verifactuRecord.findMany({ where: c, orderBy: { seq: 'asc' } });
    let prevHash = null;
    let expect = 1;
    for (const r of recs) {
      checked += 1;
      const broken = (reason) => ({ ok: false, checked, brokenAt: r.seq, environment: r.environment, reason });
      if (r.seq !== expect) return broken('a record is missing from the sequence');
      if ((r.previousHash ?? null) !== prevHash) return broken('the record does not continue the previous one');
      const m = /<sf:Huella>([0-9A-F]{64})<\/sf:Huella><\/sf:RegistroAlta>$/.exec(r.xml);
      if (!m || m[1] !== r.hash) return broken('the stored XML does not match the stored fingerprint');
      if (rehash(r) !== r.hash) return broken('the fingerprint does not match the record fields');
      prevHash = r.hash;
      expect += 1;
    }
  }
  return { ok: true, checked };
}

async function exportXml() {
  const shop = await loadShop();
  const recs = await prisma.verifactuRecord.findMany({ orderBy: [{ environment: 'asc' }, { seq: 'asc' }] });
  return dom.envelope(issuerName(shop), issuerNif(shop), recs.map((r) => r.xml));
}

// ---- submission to AEAT ----
let sender = aeat.sendToAeat;
function setSender(fn) {
  sender = fn || aeat.sendToAeat;
}
let sending = false;

async function submitChain(nif, environment) {
  const pending = { issuerNif: nif, environment, status: { in: ['PENDING', 'ERROR'] } };
  // AEAT asks senders to wait between submissions; every waiting record carries the same release time.
  if (await prisma.verifactuRecord.findFirst({ where: { ...pending, nextAttemptAt: { gt: new Date() } } })) return 0;
  const recs = await prisma.verifactuRecord.findMany({ where: pending, orderBy: { seq: 'asc' }, take: BATCH });
  if (recs.length === 0) return 0;
  const shop = await loadShop();
  if (!shop?.vfEnabled || !shop.vfCertEnc || !shop.vfCertPassEnc) return 0; // waits for a certificate
  const p12 = decrypt(shop.vfCertEnc);
  const pass = decrypt(shop.vfCertPassEnc);
  if (!p12 || pass == null) {
    console.error('VERI*FACTU certificate cannot be decrypted (was the app secret changed?). Upload it again.');
    return 0;
  }
  const body = dom.envelope(issuerName(shop), nif, recs.map((r) => r.xml));
  const release = (ms) => prisma.verifactuRecord.updateMany({ where: pending, data: { nextAttemptAt: new Date(Date.now() + ms) } });
  let resp;
  try {
    resp = await sender(environment, Buffer.from(p12, 'base64'), pass, body);
  } catch (e) {
    await prisma.verifactuRecord.updateMany({
      where: { id: { in: recs.map((r) => r.id) } },
      data: { status: 'ERROR', errorText: String(e.message).slice(0, 1000), attempts: { increment: 1 } },
    });
    await release(RETRY_MS);
    console.error(`VERI*FACTU submission failed: ${e.message}`);
    return 0;
  }
  const byKey = new Map(resp.lines.map((l) => [`${l.number}|${l.issueDate}|${l.operation}`, l]));
  for (const r of recs) {
    const l = byKey.get(`${r.invoiceNumber}|${r.issueDate}|Alta`);
    let status;
    let errorCode = null;
    let errorText = null;
    if (!l && resp.state === 'Correcto') status = 'ACCEPTED';
    else if (!l) {
      status = 'ERROR';
      errorText = 'AEAT returned no result for this record';
    } else if (l.state === 'Correcto') status = 'ACCEPTED';
    else if (l.state === 'AceptadoConErrores') {
      status = 'ACCEPTED_WITH_ERRORS';
      errorCode = l.errorCode;
      errorText = l.errorText;
    } else {
      status = 'REJECTED';
      errorCode = l.errorCode;
      errorText = l.errorText;
    }
    await prisma.verifactuRecord.update({
      where: { id: r.id },
      data: { status, errorCode, errorText, csv: resp.csv || null, responseXml: resp.raw, submittedAt: new Date(), attempts: { increment: 1 } },
    });
  }
  await release(Math.max(resp.waitSeconds, 60) * 1000);
  return recs.length;
}

async function submitAll() {
  if (sending) return 0;
  sending = true;
  try {
    const chains = await prisma.verifactuRecord.findMany({
      where: { status: { in: ['PENDING', 'ERROR'] }, nextAttemptAt: { lte: new Date() } },
      distinct: ['issuerNif', 'environment'],
      select: { issuerNif: true, environment: true },
    });
    let sent = 0;
    for (const c of chains) sent += await submitChain(c.issuerNif, c.environment);
    return sent;
  } finally {
    sending = false;
  }
}

async function sendNow() {
  await prisma.verifactuRecord.updateMany({ where: { status: { in: ['PENDING', 'ERROR'] } }, data: { nextAttemptAt: new Date() } });
  return { sent: await submitAll() };
}

function startSubmitter() {
  // unref(): never keep the process alive just for this timer.
  const tick = () => submitAll().catch((e) => console.error('VERI*FACTU submission run failed:', e.message));
  setInterval(tick, 60 * 1000).unref();
  setTimeout(tick, 30 * 1000).unref();
}

module.exports = {
  producer, problems, getSettings, saveSettings, uploadCertificate, recordSale, recordReturn, qrForInvoice, withQr,
  records, verifyChain, exportXml, submitAll, sendNow, setSender, startSubmitter,
};
