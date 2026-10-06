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
  assert.deepEqual(names, ['check_warranty', 'create_bill', 'get_bill', 'get_stock', 'search_products']); // key has no orders:write
  const call = await rpc(3, 'tools/call', { name: 'check_warranty', arguments: { serial: 'SN-ABCD-0001' } });
  assert.match(call.result.content[0].text, /ACTIVE/);
  const noAuth = await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  assert.equal(noAuth.status, 401);
});

// ---------------------------------------------------------------------------
// Roadmap features
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

async function rawUpload(url, body, contentType = 'application/octet-stream') {
  // admin client keeps its cookie; reuse via a tiny fetch with the same jar
  return admin.raw(url, body, contentType);
}

test('bulk import: preview, errors, duplicates, serials, commit, xlsx', async () => {
  const csv = [
    'Name,Barcode,SKU,Category,HSN,Unit,Purchase Price,Selling Price,Tax Rate,Stock,Track Serial,Warranty Months,Serials,Supplier',
    'Cola 1L,8900000000011,COLA-1,Drinks,2202,PCS,30,45,12,50,,,,Acme Dist',
    'Cola 1L,8900000000011,,Drinks,,PCS,30,45,12,5,,,,',            // duplicate barcode (earlier row)
    ',,,,,,,10,,,,,,',                                               // missing name
    'Bad Price,,,,,,,abc,,,,,,',                                     // bad number
    'Loose Rice,,,Grocery,1006,KGS,70,95,5,40.5,,,,',                // no barcode -> generated, fractional stock
    'Phone Z,PHZ-1,,Mobiles,8517,PCS,9000,12000,18,,yes,12,490154203237518; 356938035643809,Acme Dist',  // first IMEI already registered
    'Phone Y,PHY-1,,Mobiles,8517,PCS,9000,12000,18,,yes,12,356938035643809; 352099001761481,Acme Dist',
  ].join('\n');

  const prev = await admin.raw('/api/products/import?format=csv&dry_run=1', csv, 'text/csv');
  assert.equal(prev.status, 200, JSON.stringify(prev.data));
  assert.equal(prev.data.dryRun, true);
  assert.equal(prev.data.total, 7);
  assert.equal(prev.data.valid, 3);
  assert.equal(prev.data.duplicates, 1);
  assert.equal(prev.data.errors, 3);
  const byRow = Object.fromEntries(prev.data.results.map((r) => [r.row, r]));
  assert.match(byRow[5].message, /barcode generated/);
  assert.match(byRow[6].message, /already registered/);
  // nothing written by a preview
  assert.equal((await admin.get('/api/products')).data.filter((p) => p.name === 'Cola 1L').length, 0);

  const done = await admin.raw('/api/products/import?format=csv', csv, 'text/csv');
  assert.equal(done.data.committed, 3);
  const all = (await admin.get('/api/products')).data;
  const rice = all.find((p) => p.name === 'Loose Rice');
  assert.equal(rice.stock, 40.5);
  assert.match(rice.barcode, /^2\d{12}$/);
  const phoneY = all.find((p) => p.name === 'Phone Y');
  assert.equal(phoneY.stock, 2);
  assert.equal(phoneY.trackSerial, true);
  assert.ok(all.find((p) => p.name === 'Cola 1L').supplierId);

  // re-importing the same file: everything valid becomes a duplicate
  const again = await admin.raw('/api/products/import?format=csv&dry_run=1', csv, 'text/csv');
  assert.equal(again.data.valid, 0);

  // xlsx path
  const x = await admin.raw('/api/products/import?format=xlsx', fs.readFileSync(path.join(__dirname, 'fixtures/products.xlsx')), 'application/octet-stream');
  assert.equal(x.status, 200, JSON.stringify(x.data));
  assert.equal(x.data.committed, 2);

  const sample = await admin.get('/api/products/import/sample.csv');
  assert.match(sample.data.toString(), /^name,barcode,sku/);
});

test('fractional quantities: sell 0.250 kg and keep stock exact', async () => {
  const rice = (await admin.get('/api/products')).data.find((p) => p.name === 'Loose Rice');
  const sale = await admin.post('/api/invoices', { items: [{ productId: rice.id, quantity: 0.25 }], paymentMethod: 'UPI' });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  assert.equal(sale.data.totalAmount, 23.75);
  const after = (await admin.get('/api/products')).data.find((p) => p.id === rice.id);
  assert.equal(Math.round(after.stock * 1000) / 1000, 40.25);
  assert.equal((await admin.post('/api/invoices', { items: [{ productId: rice.id, quantity: 0.0001 }], paymentMethod: 'UPI' })).status, 400);
});

test('permissions: cashier without returns/discount is blocked; discount cap enforced', async () => {
  const mk = await admin.post('/api/auth/users', { name: 'Cash', email: 'c@example.com', password: 'cashier-pass-1', role: 'cashier', permissions: ['discount'], maxDiscountPercent: 10, confirmPassword: PW });
  assert.equal(mk.status, 201, JSON.stringify(mk.data));
  const c = client(srv.base);
  assert.equal((await c.post('/api/auth/login', { email: 'c@example.com', password: 'cashier-pass-1' })).status, 200);
  const rice = (await admin.get('/api/products')).data.find((p) => p.name === 'Loose Rice');
  const ok = await c.post('/api/invoices', { items: [{ productId: rice.id, quantity: 1 }], paymentMethod: 'UPI', discountType: 'percent', discountValue: 10 });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const over = await c.post('/api/invoices', { items: [{ productId: rice.id, quantity: 1 }], paymentMethod: 'UPI', discountType: 'percent', discountValue: 11 });
  assert.equal(over.status, 403);
  assert.equal(over.data.code, 'DISCOUNT_LIMIT');
  assert.equal((await c.post('/api/returns', { invoiceId: 1, items: [{ invoiceItemId: 1, quantity: 1 }] })).status, 403);
  assert.equal((await c.get('/api/reports/overview')).status, 403);
  assert.equal((await c.post('/api/products', { barcode: 'x', name: 'x', purchasePrice: 1, sellingPrice: 2, taxRate: 0 })).status, 403);
});

test('shifts: open, cash sale, close with variance', async () => {
  const open = await admin.post('/api/shifts/open', { openingFloat: 500 });
  assert.equal(open.status, 201);
  const rice = (await admin.get('/api/products')).data.find((p) => p.name === 'Loose Rice');
  await admin.post('/api/invoices', { items: [{ productId: rice.id, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 100 });
  await admin.post('/api/shifts/movement', { type: 'OUT', amount: 20, note: 'tea' });
  const cur = await admin.get('/api/shifts/current');
  assert.equal(cur.data.expectedCash, 500 + 95 - 20);
  const closed = await admin.post('/api/shifts/close', { closingCounted: 570 });
  assert.equal(closed.data.variance, -5);
  assert.equal((await admin.get('/api/shifts/current')).data, null);
});

test('reports: margins, categories, heatmap, GSTR-1 and tax summary', async () => {
  const o = await admin.get('/api/reports/overview');
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.ok(o.data.totals.bills >= 5);
  assert.ok(o.data.totals.grossProfit > 0);
  assert.ok(o.data.categories.find((c) => c.category === 'Grocery'));
  assert.equal(o.data.heatmap.length, 7);
  assert.equal(o.data.heatmap[0].length, 24);
  assert.ok((await admin.get('/api/reports/compare?period=week')).data.current.bills >= 1);
  const month = new Date().toISOString().slice(0, 7);
  const g = await admin.get(`/api/reports/gstr1?month=${month}`);
  assert.equal(g.status, 200);
  assert.ok(g.data.hsn.length > 0);
  const csv = await admin.get(`/api/reports/gstr1.csv?month=${month}&section=hsn`);
  assert.match(csv.data.toString(), /^HSN,UQC/);
  assert.match((await admin.get('/api/reports/tax-summary.csv')).data.toString(), /^Tax rate/);
  assert.equal((await admin.get('/api/reports/gstr1?month=bad')).status, 400);
});

test('purchasing: suppliers, reorder suggestion, PO receive updates stock + cost', async () => {
  const sup = (await admin.post('/api/purchasing/suppliers', { name: 'Metro Wholesale' })).data;
  const cola = (await admin.get('/api/products')).data.find((p) => p.name === 'Cola 1L');
  await admin.put(`/api/products/${cola.id}`, { reorderPoint: 100, supplierId: sup.id });
  const re = await admin.get('/api/purchasing/reorder');
  const grp = re.data.find((g) => g.supplierId === sup.id);
  assert.ok(grp && grp.items[0].suggestedQty >= 50);
  const po = await admin.post('/api/purchasing/orders', { supplierId: sup.id, items: [{ productId: cola.id, quantity: 60, unitCost: 31 }] });
  assert.equal(po.status, 201, JSON.stringify(po.data));
  assert.equal(po.data.totalCost, 1860);
  const pdf = await admin.get(`/api/purchasing/orders/${po.data.id}/pdf`);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  const rec = await admin.post(`/api/purchasing/orders/${po.data.id}/receive`, { items: [{ itemId: po.data.items[0].id, quantity: 60 }] });
  assert.equal(rec.data.status, 'RECEIVED');
  const after = (await admin.get('/api/products')).data.find((p) => p.id === cola.id);
  assert.equal(after.stock, 110);
  assert.equal(after.purchasePrice, 31);
  assert.equal((await admin.post(`/api/purchasing/orders/${po.data.id}/receive`, { items: [{ itemId: po.data.items[0].id, quantity: 1 }] })).status, 409);
});

test('orders: API order reserves stock, kanban status, collect bills it; QR menu is public + validated', async () => {
  const cola = (await admin.get('/api/products')).data.find((p) => p.name === 'Cola 1L');
  await admin.put(`/api/products/${cola.id}`, { showInMenu: true });
  const k = await admin.post('/api/api-keys', { name: 'orders', scopes: ['products:read', 'orders:write'], confirmPassword: PW });
  const hdr = { authorization: `Bearer ${k.data.apiKey}` };
  const api = client(srv.base);
  const before = (await api.get('/api/external/products?q=Cola', hdr)).data.find((p) => p.sku === 'COLA-1');
  const o = await api.post('/api/external/orders', { externalId: 'web-77', items: [{ sku: 'COLA-1', quantity: 10 }], customer: { name: 'Meena', phone: '7777700000' }, paid: true }, hdr);
  assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.match(o.data.order.pickupCode, /^[A-Z2-9]{6}$/);
  assert.equal((await api.post('/api/external/orders', { externalId: 'web-77', items: [{ sku: 'COLA-1', quantity: 10 }] }, hdr)).data.deduplicated, true);
  const mid = (await api.get('/api/external/products?q=Cola', hdr)).data.find((p) => p.sku === 'COLA-1');
  assert.equal(mid.available, before.available - 10);
  assert.equal(mid.stock, before.stock, 'physical stock untouched until billed');
  // over-reserving is refused
  assert.equal((await api.post('/api/external/orders', { externalId: 'web-78', items: [{ sku: 'COLA-1', quantity: 100000 }] }, hdr)).status, 409);

  const id = o.data.order.id;
  assert.equal((await admin.patch(`/api/orders/${id}/status`, { status: 'READY' })).status, 200);
  assert.equal((await admin.get(`/api/orders/by-code/${o.data.order.pickupCode}`)).data.id, id);
  const col = await admin.post(`/api/orders/${id}/collect`, { paymentMethod: 'UPI' });
  assert.equal(col.status, 200, JSON.stringify(col.data));
  assert.equal(col.data.order.status, 'COLLECTED');
  const after = (await admin.get('/api/products')).data.find((p) => p.id === cola.id);
  assert.equal(after.stock, before.stock - 10);
  assert.equal((await admin.post(`/api/orders/${id}/collect`, { paymentMethod: 'UPI' })).status, 409);

  // public QR menu
  const pub = client(srv.base);
  const menu = await pub.get('/api/public/menu');
  assert.ok(menu.data.items.find((i) => i.name === 'Cola 1L'));
  const bad = await pub.post('/api/public/menu/order', { name: 'x', items: [{ productId: 999999, quantity: 1 }] });
  assert.equal(bad.status, 400);
  const good = await pub.post('/api/public/menu/order', { name: 'Table guest', tableNo: '4', fulfilment: 'DINE_IN', items: [{ productId: cola.id, quantity: 2 }] });
  assert.equal(good.status, 201, JSON.stringify(good.data));
  assert.equal(good.data.total, 90);
  const st = await pub.get(`/api/public/order/${good.data.id}?code=${good.data.pickupCode}`);
  assert.equal(st.data.status, 'NEW');
  assert.equal((await pub.get(`/api/public/order/${good.data.id}?code=WRONG1`)).status, 404);
});

test('store webhooks: bad signature rejected, valid Woo order becomes an order', async () => {
  const crypto = require('crypto');
  const made = await admin.post('/api/integrations', { platform: 'woocommerce', name: 'My Woo', confirmPassword: PW });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const url = new URL(made.data.webhookUrl).pathname;
  const body = JSON.stringify({ id: 5001, status: 'processing', billing: { first_name: 'A', last_name: 'B', phone: '6666600000' }, line_items: [{ sku: 'COLA-1', quantity: 1 }, { sku: 'NOPE', quantity: 1 }] });
  const sig = crypto.createHmac('sha256', made.data.webhookSecret).update(body).digest('base64');
  const pub = client(srv.base);
  const bad = await pub.raw(url, body, 'application/json', { 'x-wc-webhook-signature': 'AAAA' });
  assert.equal(bad.status, 401);
  const ok = await pub.raw(url, body, 'application/json', { 'x-wc-webhook-signature': sig });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.orderId);
  const again = await pub.raw(url, body, 'application/json', { 'x-wc-webhook-signature': sig });
  assert.equal(again.data.deduplicated, true);
});

test('customer portal + WhatsApp share + NFC card', async () => {
  const cust = (await admin.get('/api/customers/phone/9999900000')).data;
  const link = await admin.get(`/api/customers/${cust.id}/portal-link`);
  const token = link.data.url.split('/me/')[1];
  const pub = client(srv.base);
  const portal = await pub.get(`/api/public/customer/${token}`);
  assert.equal(portal.status, 200);
  assert.equal(portal.data.customer.name, 'Asha');
  assert.ok(portal.data.receipts.length >= 1);
  assert.equal((await pub.get(`/api/public/customer/${token}x`)).status, 404);
  // a receipt token is not a portal token
  const rcpt = new URL(portal.data.receipts[0].url).pathname.split('/').pop();
  assert.equal((await pub.get(`/api/public/customer/${rcpt}`)).status, 404);

  const inv = (await admin.get('/api/invoices')).data.find((i) => i.customerPhone === '9999900000');
  const share = await admin.get(`/api/payments/share/${inv.id}`);
  assert.match(share.data.whatsappUrl, /^https:\/\/wa\.me\/919999900000\?text=/);

  assert.equal((await admin.put(`/api/customers/${cust.id}/card`, { cardUid: '04:A1:B2:C3' })).status, 200);
  assert.equal((await admin.get('/api/customers/by-card/04a1b2c3')).data.id, cust.id);
});

test('UPI uri, FX rates + multi-currency sale, label ZPL', async () => {
  const upi = await admin.get('/api/payments/upi?amount=11800&ref=INV1');
  assert.match(upi.data.uri, /^upi:\/\/pay\?pa=shop%40okbank/);
  assert.match(upi.data.uri, /am=11800\.00/);
  assert.equal((await admin.put('/api/payments/fx', { rates: { USD: 80 } })).status, 200);
  const rice = (await admin.get('/api/products')).data.find((p) => p.name === 'Loose Rice');
  const s = await admin.post('/api/invoices', { items: [{ productId: rice.id, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 95, payCurrency: 'USD' });
  assert.equal(s.data.payCurrency, 'USD');
  assert.equal(s.data.payRate, 80);
  assert.equal(s.data.payAmount, 1.19);
  assert.equal((await admin.post('/api/invoices', { items: [{ productId: rice.id, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 95, payCurrency: 'EUR' })).status, 400);
  const zpl = await admin.get(`/api/print/label/${rice.id}?copies=2`);
  assert.match(zpl.data.toString(), /\^XA[\s\S]*\^PQ2[\s\S]*\^XZ/);
});

test('branch <-> hub sync (encrypted), transfer applies once', async () => {
  const sync = require('../src/lib/sync');
  // Hub role on this instance; create a branch and push a sealed snapshot.
  assert.equal((await admin.put('/api/sync', { role: 'hub', confirmPassword: PW })).status, 200);
  const br = await admin.post('/api/hub/branches', { code: 'B2', name: 'Branch Two', confirmPassword: PW });
  assert.equal(br.status, 201, JSON.stringify(br.data));
  const secret = br.data.secret;
  const ingest = async (msg, secretUsed = secret) => {
    const r = await fetch(`${srv.base}/api/hub/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-branch': 'B2' }, body: JSON.stringify({ d: sync.seal(secretUsed, msg) }) });
    return { status: r.status, reply: r.ok ? sync.open(secretUsed, (await r.json()).d) : null };
  };
  const day = new Date().toISOString().slice(0, 10);
  const first = await ingest({ ts: Date.now(), stock: [{ barcode: 'T-1', name: 'Widget', category: 'X', stock: 12, price: 5 }], days: [{ day, revenue: 250, tax: 10, cost: 100, count: 4 }], acks: [] });
  assert.equal(first.status, 200);
  assert.equal((await ingest({ ts: Date.now(), stock: [], days: [] }, 'wrong-secret-wrong-secret')).status, 401);
  assert.equal((await ingest({ ts: Date.now() - 3600000, stock: [], days: [] })).status, 401, 'stale message rejected');
  const ov = await admin.get('/api/hub/overview');
  assert.equal(ov.data.branches.find((b) => b.code === 'B2').today.revenue, 250);
  assert.equal((await admin.get('/api/hub/inventory?q=Widget')).data[0].branches[br.data.id], 12);
});
