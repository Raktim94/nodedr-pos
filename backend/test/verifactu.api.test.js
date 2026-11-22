// Spain VERI*FACTU end to end against the real server and a throwaway SQLite database.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const forge = require('node-forge');
const { startServer, client } = require('./helpers');

process.env.VERIFACTU_PRODUCER_ID = 'U0000000000000000000';
const PW = 'correct-horse-battery';
let srv;
let admin;
let p10;
let p21;

function selfSignedP12(password) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: 'TEST SL 89890001K' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password)).getBytes(), 'binary');
}

const sale = (items, extra = {}) => admin.post('/api/invoices', { items, paymentMethod: 'CARD', amountPaid: 0, ...extra });
const records = async () => (await admin.get('/api/verifactu/records?take=200')).data.items.sort((a, b) => a.seq - b.seq);

test.before(async () => {
  srv = await startServer(4179);
  admin = client(srv.base);
  assert.equal((await admin.post('/api/auth/register', { name: 'Ana', email: 'ana@example.test', password: PW })).status, 201);
  assert.equal((await admin.post('/api/auth/login', { email: 'ana@example.test', password: PW })).status, 200);
  const s = await admin.post('/api/settings', { shopName: 'Bar Test', legalName: 'Bar & Grill SL', address1: 'Calle Mayor 1', gstEnabled: true, currencyCode: 'EUR' });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  p10 = (await admin.post('/api/products', { barcode: 'P10', name: 'Paella', purchasePrice: 5, sellingPrice: 11, taxRate: 10, stock: 1000 })).data;
  p21 = (await admin.post('/api/products', { barcode: 'P21', name: 'Vino', purchasePrice: 5, sellingPrice: 12.1, taxRate: 21, stock: 1000 })).data;
});
test.after(() => srv?.stop());

test('anonymous callers cannot reach the VERI*FACTU API', async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/verifactu/settings')).status, 401);
});

test('a sale made before VERI*FACTU is on has no record; turning it on explains what is missing', async () => {
  const before = await sale([{ productId: p10.id, quantity: 1 }]);
  assert.equal(before.status, 201, JSON.stringify(before.data));
  assert.equal((await records()).length, 0);

  const s = (await admin.get('/api/verifactu/settings')).data;
  assert.equal(s.enabled, false);
  assert.equal(s.status, 'implemented-not-certified');
  assert.ok(s.problems.some((p) => /NIF/.test(p)));
  const refused = await admin.put('/api/verifactu/settings', { enabled: true, environment: 'TEST', series: 'T1' });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /NIF/);
  const on = await admin.put('/api/verifactu/settings', { enabled: true, environment: 'TEST', series: 'T1', nif: 'b12345678' });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(on.data.enabled, true);
  assert.equal(on.data.nif, 'B12345678');
  assert.deepEqual(on.data.problems, []);
});

test('a sale becomes a numbered F2 record; the receipt carries the QR; every print layout renders', async () => {
  const r = await sale([{ productId: p10.id, quantity: 2 }, { productId: p21.id, quantity: 1 }]);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.totalAmount, 34.1);
  const recs = await records();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].invoiceNumber, 'T1-000001');
  assert.equal(recs[0].invoiceType, 'F2');
  assert.equal(recs[0].totalCents, 3410);
  assert.equal(recs[0].taxTotalCents, 410); // 2 x 11.00 @10% = 2.00, 12.10 @21% = 2.10
  assert.equal(recs[0].status, 'PENDING');

  const html = (await admin.get(`/api/print/${r.data.id}/receipt`)).data.toString();
  assert.match(html, /Factura simplificada T1-000001/);
  assert.match(html, /QR tributario:/);
  assert.match(html, /<svg[^>]+width="35mm"/);
  assert.match(html, /IVA \(incl\.\)/);
  assert.doesNotMatch(html, /CGST|SGST/);
  assert.match(html, /NIF: B12345678/);

  for (const layout of ['receipt', 'a4']) {
    const pdf = await admin.get(`/api/print/${r.data.id}/pdf?layout=${layout}`);
    assert.equal(pdf.status, 200, `${layout} pdf`);
    assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  }

  const { buildReceiptEscPos } = require('../src/lib/escposReceipt');
  const shop = (await admin.get('/api/settings')).data;
  const inv = (await admin.get(`/api/invoices/${r.data.id}`)).data;
  const qr = { url: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=T1-000001&fecha=18-10-2026&importe=34.10', heading: 'QR tributario:', legend: 'Factura verificable en la sede electrónica de la AEAT', short: 'VERI*FACTU', invoiceNumber: 'T1-000001' };
  const withQr = buildReceiptEscPos({ shop, invoice: { ...inv, verifactu: qr }, width: 48 });
  assert.ok(withQr.includes(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06])), 'module size 6');
  assert.ok(withQr.includes(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31])), 'error correction M');
  assert.ok(withQr.includes(Buffer.from(qr.url)));
  assert.ok(withQr.includes(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])), 'print command');
  assert.match(withQr.toString('latin1'), /Factura simplificada T1-000001/);
  const without = buildReceiptEscPos({ shop, invoice: inv, width: 48 });
  assert.equal(without.includes(Buffer.from([0x1d, 0x28, 0x6b])), false);
});

test('a return is a corrective R5 pointing at the original; a return of an older sale gets none', async () => {
  const recs = await records();
  const orig = recs[0];
  const full = (await admin.get(`/api/invoices/${orig.invoiceId}`)).data;
  const line = full.items.find((i) => i.taxRate === 10);
  const ret = await admin.post('/api/returns', { invoiceId: orig.invoiceId, items: [{ invoiceItemId: line.id, quantity: 1 }], confirmPassword: PW });
  assert.equal(ret.status, 201, JSON.stringify(ret.data));
  const after = await records();
  const r5 = after[after.length - 1];
  assert.equal(r5.invoiceType, 'R5');
  assert.equal(r5.invoiceNumber, 'RT1-000001');
  assert.equal(r5.totalCents, -1100);
  assert.equal(r5.taxTotalCents, -100);

  // a sale from before VERI*FACTU was switched on has no invoice to rectify
  const list = (await admin.get('/api/invoices')).data;
  const old = list.find((i) => !after.some((r) => r.invoiceId === i.id));
  const oldFull = (await admin.get(`/api/invoices/${old.id}`)).data;
  const n = after.length;
  assert.equal((await admin.post('/api/returns', { invoiceId: old.id, items: [{ invoiceItemId: oldFull.items[0].id, quantity: 1 }], confirmPassword: PW })).status, 201);
  assert.equal((await records()).length, n);
});

test('a bill that sells and returns at once writes both records, in order', async () => {
  const before = (await records()).length;
  const orig = (await records())[0];
  const full = (await admin.get(`/api/invoices/${orig.invoiceId}`)).data;
  const line = full.items.find((i) => i.taxRate === 21);
  const r = await sale([{ productId: p10.id, quantity: 1 }], { returns: [{ invoiceId: orig.invoiceId, items: [{ invoiceItemId: line.id, quantity: 1 }] }], confirmPassword: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const after = await records();
  assert.equal(after.length, before + 2);
  const [a, b] = after.slice(-2);
  assert.equal(a.invoiceType, 'F2');
  assert.equal(a.totalCents, 1100);
  assert.equal(b.invoiceType, 'R5');
  assert.equal(b.totalCents, -1210);
});

test('concurrent sales keep unique, gap-free numbers and an intact chain', async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => sale([{ productId: p10.id, quantity: 1 }])));
  for (const x of results) assert.equal(x.status, 201, JSON.stringify(x.data));
  const recs = await records();
  assert.deepEqual(recs.map((r) => r.seq), recs.map((_, i) => i + 1));
  assert.equal(new Set(recs.map((r) => r.invoiceNumber)).size, recs.length);
  const v = (await admin.get('/api/verifactu/verify')).data;
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.checked, recs.length);
});

test('the log is append-only at the database level', () => {
  const db = new Database(srv.dbPath);
  try {
    assert.throws(() => db.prepare('UPDATE verifactu_records SET totalCents = 1 WHERE id = 1').run(), /append-only/);
    assert.throws(() => db.prepare("UPDATE verifactu_records SET hash = 'X' WHERE id = 1").run(), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM verifactu_records WHERE id = 1').run(), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM verifactu_records').run(), /append-only/);
    // the submission outcome is the one thing that may change
    assert.doesNotThrow(() => db.prepare('UPDATE verifactu_records SET attempts = attempts + 1 WHERE id = 1').run());
    const last = db.prepare('SELECT * FROM verifactu_records ORDER BY seq DESC LIMIT 1').get();
    const ins = db.prepare(
      "INSERT INTO verifactu_records (issuerNif, environment, seq, type, invoiceType, invoiceNumber, issueDate, taxTotalCents, totalCents, generatedAt, previousHash, hash, xml) VALUES ('B12345678','TEST', ?, 'ALTA','F2', ?, '01-01-2026',0,0,'t', ?, 'H','x')"
    );
    assert.throws(() => ins.run(last.seq + 1, 'T1-X1', 'WRONG'), /does not continue the chain/);
    assert.throws(() => ins.run(last.seq + 5, 'T1-X2', last.hash), /does not continue the chain/);
  } finally {
    db.close();
  }
});

test('certificate: wrong password refused, secrets never returned, XML exports every record', async () => {
  const p12 = selfSignedP12('pw');
  // multipart through the cookie-jar client: build the body by hand
  const boundary = '----vf' + Date.now();
  const body = (password) =>
    Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="password"\r\n\r\n${password}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.p12"\r\nContent-Type: application/x-pkcs12\r\n\r\n`),
      p12,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
  const ct = `multipart/form-data; boundary=${boundary}`;
  const bad = await admin.raw('/api/verifactu/certificate', body('wrong'), ct);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Cannot read the certificate/);
  const good = await admin.raw('/api/verifactu/certificate', body('pw'), ct);
  assert.equal(good.status, 200, JSON.stringify(good.data));
  assert.equal(good.data.hasCertificate, true);
  assert.equal(good.data.certSubject, 'CN=TEST SL 89890001K');

  const settings = (await admin.get('/api/settings')).data;
  assert.equal(settings.vfCertEnc, undefined);
  assert.equal(settings.vfCertPassEnc, undefined);
  const db = new Database(srv.dbPath, { readonly: true });
  const row = db.prepare('SELECT vfCertEnc FROM ShopSettings').get();
  db.close();
  assert.ok(row.vfCertEnc.startsWith('v1.'), 'stored encrypted');
  assert.ok(!row.vfCertEnc.includes(p12.toString('base64').slice(0, 40)), 'not stored in clear');

  const xml = (await admin.get('/api/verifactu/export.xml')).data.toString();
  const count = (await records()).length;
  assert.equal((xml.match(/<sfLR:RegistroFactura>/g) || []).length, count);
  assert.match(xml, /<sf:NombreRazon>Bar &amp; Grill SL<\/sf:NombreRazon><sf:NIF>B12345678<\/sf:NIF>/);
});

test('a sale with an IVA rate Spain does not use is refused and rolled back whole', async () => {
  const odd = (await admin.post('/api/products', { barcode: 'P18', name: 'Odd', purchasePrice: 1, sellingPrice: 10, taxRate: 18, stock: 5 })).data;
  const before = (await records()).length;
  const r = await sale([{ productId: odd.id, quantity: 1 }]);
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /not a Spanish IVA rate/);
  assert.equal((await records()).length, before);
  assert.equal((await admin.get('/api/products')).data.find((p) => p.id === odd.id).stock, 5, 'stock untouched');
});

test('a shop that is not on euros never records, even with the switch left on', async () => {
  const before = (await records()).length;
  assert.equal((await admin.put('/api/settings', { currencyCode: 'USD', confirmPassword: PW })).status, 200);
  try {
    const r = await sale([{ productId: p10.id, quantity: 1 }]);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal((await records()).length, before);
  } finally {
    assert.equal((await admin.put('/api/settings', { currencyCode: 'EUR', confirmPassword: PW })).status, 200);
  }
});
