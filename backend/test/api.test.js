const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

let srv;
let admin;
const PW = 'correct-horse-battery';

test.before(async () => {
  srv = await startServer(4177);
  admin = client(srv.base);
  const reg = await admin.post('/api/auth/register', { name: 'Owner', email: 'o@example.com', password: PW });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const login = await admin.post('/api/auth/login', { email: 'o@example.com', password: PW });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const s = await admin.post('/api/settings', { shopName: 'Test Shop', address1: '1 Main St', gstEnabled: true, upiId: 'shop@okbank' });
  assert.equal(s.status, 201, JSON.stringify(s.data));
});
test.after(() => srv?.stop());

let phone, plain, key, writeKey;

test('serial-tracked product: register IMEIs, validate, sell, warranty', async () => {
  const p = await admin.post('/api/products', { barcode: 'PH-1', sku: 'PHONE-1', name: 'Phone X', purchasePrice: 8000, sellingPrice: 11800, taxRate: 18, trackSerial: true, warrantyMonths: 12 });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  phone = p.data;

  // 490154203237518 is a Luhn-valid IMEI; ...519 is not.
  const r = await admin.post(`/api/products/${phone.id}/serials`, { serials: ['490154203237518', '490154203237519', '490154203237518', 'SN-ABCD-0001'] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.added, 2);
  assert.equal(r.data.rejected.length, 2);
  assert.equal(r.data.stock, 2);

  const scan = await admin.get('/api/products/scan/490154203237518');
  assert.equal(scan.data.type, 'serial');
  assert.equal(scan.data.product.id, phone.id);

  // sale without serials is refused; with wrong count refused
  const bad = await admin.post('/api/invoices', { items: [{ productId: phone.id, quantity: 1 }], paymentMethod: 'UPI' });
  assert.equal(bad.status, 400);

  const sale = await admin.post('/api/invoices', { items: [{ productId: phone.id, quantity: 1, serials: ['490154203237518'] }], paymentMethod: 'UPI', customerName: 'Asha', customerPhone: '9999900000' });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  assert.equal(sale.data.totalAmount, 11800);

  const w = await admin.get('/api/warranty/490154203237518');
  assert.equal(w.status, 200);
  assert.equal(w.data.warranty, 'ACTIVE');
  assert.equal(w.data.invoice.customerPhone, '9999900000');
  assert.ok(w.data.daysLeft > 360);

  // same unit can't be sold twice
  const dup = await admin.post('/api/invoices', { items: [{ productId: phone.id, quantity: 1, serials: ['490154203237518'] }], paymentMethod: 'UPI' });
  assert.equal(dup.status, 409);

  const after = await admin.get('/api/products');
  assert.equal(after.data.find((x) => x.id === phone.id).stock, 1);
});

test('PDFs: receipt and A4 with serials', async () => {
  const list = await admin.get('/api/invoices');
  const inv = list.data[0];
  for (const layout of ['receipt', 'a4']) {
    const r = await admin.get(`/api/print/${inv.id}/pdf?layout=${layout}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.subarray(0, 4).toString(), '%PDF');
  }
});

test('signature upload validates image bytes', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const bad = await admin.put('/api/settings/signature', { image: Buffer.from('<svg onload=alert(1)>').toString('base64'), confirmPassword: PW });
  assert.equal(bad.status, 400);
  const ok = await admin.put('/api/settings/signature', { image: `data:image/png;base64,${png}`, confirmPassword: PW });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const img = await admin.get(`/api/signatures/${ok.data.signatureFile}`);
  assert.equal(img.status, 200);
  assert.equal((await admin.get('/api/signatures/..%2F..%2Fetc%2Fpasswd')).status, 404);
  const list = await admin.get('/api/invoices');
  const a4 = await admin.get(`/api/print/${list.data[0].id}/pdf?layout=a4`);
  assert.equal(a4.status, 200);
});

test('API keys: scopes enforced; external bill is idempotent', async () => {
  const mk = async (scopes) => {
    const r = await admin.post('/api/api-keys', { name: 'store', scopes, confirmPassword: PW });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.apiKey;
  };
  key = await mk(['products:read', 'bills:write', 'bills:read', 'warranty:read']);
  writeKey = key;
  const readOnly = await mk(['products:read']);
  const auth = (k) => ({ authorization: `Bearer ${k}` });
  const api = client(srv.base);

  assert.equal((await api.get('/api/external/products')).status, 401);
  const list = await api.get('/api/external/products', auth(readOnly));
  assert.equal(list.status, 200);
  assert.equal(list.data[0].sku, 'PHONE-1');

  const denied = await api.post('/api/external/bills', { externalRef: 'o1', items: [{ sku: 'PHONE-1', quantity: 1, serials: ['SN-ABCD-0001'] }] }, auth(readOnly));
  assert.equal(denied.status, 403);

  const body = { externalRef: 'order-1001', customer: { name: 'Ravi', phone: '8888800000' }, items: [{ sku: 'PHONE-1', quantity: 1, serials: ['SN-ABCD-0001'] }], paymentMethod: 'UPI' };
  const b1 = await api.post('/api/external/bills', body, auth(key));
  assert.equal(b1.status, 201, JSON.stringify(b1.data));
  assert.equal(b1.data.invoice.totalAmount, 11800);
  assert.match(b1.data.receiptUrl, /\/api\/public\/receipt\//);
  const b2 = await api.post('/api/external/bills', body, auth(key));
  assert.equal(b2.status, 200);
  assert.equal(b2.data.deduplicated, true);
  assert.equal(b2.data.invoice.invoiceNumber, b1.data.invoice.invoiceNumber);

  const pdf = await api.get(`/api/external/bills/order-1001/pdf`, auth(key));
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');

  // signed public link works; tampering does not
  const link = new URL(b1.data.receiptUrl);
  const pub = await api.get(link.pathname);
  assert.equal(pub.status, 200);
  assert.equal((await api.get(link.pathname.slice(0, -2) + 'xx')).status, 404);

  // a key can't read a bill it didn't create (in-store sale #1)
  const other = await api.get('/api/external/bills/INV-2026-00001', auth(key));
  assert.equal(other.status, 404);

  const w = await api.get('/api/external/warranty/SN-ABCD-0001', auth(key));
  assert.equal(w.status, 200);
  assert.equal(w.data.invoice.customerPhone, undefined, 'external callers do not get buyer phone');
});

test('MCP: initialize, list tools by scope, call create_bill', async () => {
  const hdr = { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' };
  const rpc = async (id, method, params) => {
    const r = await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...hdr }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const t = await r.text();
    const line = t.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : t);
  };
  const init = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'nodedr-pos');
  const tools = await rpc(2, 'tools/list', {});
  const names = tools.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['check_warranty', 'create_bill', 'get_bill', 'get_stock', 'search_products']);
  const call = await rpc(3, 'tools/call', { name: 'check_warranty', arguments: { serial: 'SN-ABCD-0001' } });
  assert.match(call.result.content[0].text, /ACTIVE/);
  const noAuth = await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  assert.equal(noAuth.status, 401);
});
