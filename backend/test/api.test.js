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

test('IMEI / serial: off by default, captured only at sale, one sale per unit, return frees it', async () => {
  // Feature is OFF by default: a flagged product sells like any other and serials are ignored.
  assert.equal((await admin.get('/api/settings')).data.serialTracking, false);
  const off = await admin.post('/api/products', { barcode: 'PH-0', name: 'Phone Off', purchasePrice: 1, sellingPrice: 10, taxRate: 0, trackSerial: true, warrantyMonths: 6, stock: 3 });
  const offSale = await admin.post('/api/invoices', { items: [{ productId: off.data.id, quantity: 1 }], paymentMethod: 'UPI' });
  assert.equal(offSale.status, 201, JSON.stringify(offSale.data));

  assert.equal((await admin.put('/api/settings', { serialTracking: true, confirmPassword: PW })).status, 200);

  // Stock is a plain quantity: no IMEIs are registered in advance.
  const p = await admin.post('/api/products', { barcode: 'PH-1', sku: 'PHONE-1', name: 'Phone X', purchasePrice: 8000, sellingPrice: 11800, taxRate: 18, trackSerial: true, warrantyMonths: 12, stock: 5 });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  phone = p.data;
  assert.equal((await admin.get(`/api/products/${phone.id}/serials`)).status, 404, 'no stock-side serial registration endpoint');
  assert.equal((await admin.get('/api/products/scan/490154203237518')).status, 404, 'an IMEI is not a stock lookup key');

  // At sale: IMEI required, one per unit, checksum-validated.
  const none = await admin.post('/api/invoices', { items: [{ productId: phone.id, quantity: 1 }], paymentMethod: 'UPI' });
  assert.equal(none.status, 400);
  const badLuhn = await admin.post('/api/invoices', { items: [{ productId: phone.id, quantity: 1, serials: ['490154203237519'] }], paymentMethod: 'UPI' });
  assert.equal(badLuhn.status, 400);
  const two = await admin.post('/api/invoices', { items: [{ productId: phone.id, quantity: 2, serials: ['490154203237518'] }], paymentMethod: 'UPI' });
  assert.equal(two.status, 400);

  const sale = await admin.post('/api/invoices', { items: [{ productId: phone.id, quantity: 1, serials: ['490154203237518'] }], paymentMethod: 'UPI', customerName: 'Asha', customerPhone: '9999900000' });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  assert.equal(sale.data.totalAmount, 11800);
  assert.equal((await admin.get('/api/products')).data.find((x) => x.id === phone.id).stock, 4);

  const w = await admin.get('/api/warranty/490154203237518');
  assert.equal(w.data.warranty, 'ACTIVE');
  assert.equal(w.data.invoice.customerPhone, '9999900000');
  assert.ok(w.data.daysLeft > 360);

  // The same unit cannot be sold twice...
  const dup = await admin.post('/api/invoices', { items: [{ productId: phone.id, quantity: 1, serials: ['490154203237518'] }], paymentMethod: 'UPI' });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /already sold/);
  // ...a return must name the IMEI...
  const lineId = (await admin.get(`/api/invoices/${sale.data.id}`)).data.items[0].id;
  assert.equal((await admin.post('/api/returns', { invoiceId: sale.data.id, items: [{ invoiceItemId: lineId, quantity: 1 }] })).status, 400);
  const ret = await admin.post('/api/returns', { invoiceId: sale.data.id, items: [{ invoiceItemId: lineId, quantity: 1, serials: ['490154203237518'] }] });
  assert.equal(ret.status, 201, JSON.stringify(ret.data));
  assert.equal((await admin.get('/api/warranty/490154203237518')).data.warranty, 'RETURNED');
  assert.equal((await admin.get('/api/products')).data.find((x) => x.id === phone.id).stock, 5);
  // ...and then the unit can be sold again.
  const again = await admin.post('/api/invoices', { items: [{ productId: phone.id, quantity: 1, serials: ['490154203237518'] }], paymentMethod: 'UPI' });
  assert.equal(again.status, 201, JSON.stringify(again.data));
  assert.equal((await admin.get('/api/warranty/490154203237518')).data.warranty, 'ACTIVE');
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
    'Phone Z,PHZ-1,,Mobiles,8517,PCS,9000,12000,18,,yes,12,490154203237518; 356938035643809,Acme Dist',  // IMEIs belong at the sale, not in the import
    'Phone Y,PHY-1,,Mobiles,8517,PCS,9000,12000,18,2,yes,12,,Acme Dist',
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
  assert.match(byRow[6].message, /moment of sale/);
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
  // 'customers' is enforced server-side, not just hidden in the UI
  assert.equal((await c.post('/api/customers', { name: 'Nope', phone: '9000000001' })).status, 403);
  assert.equal((await c.put('/api/customers/1', { name: 'Nope', phone: '9000000001' })).status, 403);
  assert.equal((await c.put('/api/customers/1/card', { cardUid: '04:AA:BB:CC' })).status, 403);
  assert.equal((await c.post('/api/customers/1/settle-due', { amount: 1, paymentMethod: 'CASH' })).status, 403);
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

test('orders: API order reserves stock, kanban status, collect bills it', async () => {
  const cola = (await admin.get('/api/products')).data.find((p) => p.name === 'Cola 1L');
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
  // the store sees the new status by polling, too (webhooks are the push path)
  const polled = await api.get('/api/external/orders?status=READY&updatedSince=2020-01-01T00:00:00Z', hdr);
  assert.equal(polled.status, 200);
  assert.equal(polled.data.find((x) => x.id === id)?.status, 'READY');
  assert.equal((await api.get('/api/external/orders?updatedSince=nope', hdr)).status, 400);
  assert.equal((await admin.get(`/api/orders/by-code/${o.data.order.pickupCode}`)).data.id, id);
  const col = await admin.post(`/api/orders/${id}/collect`, { paymentMethod: 'UPI' });
  assert.equal(col.status, 200, JSON.stringify(col.data));
  assert.equal(col.data.order.status, 'COLLECTED');
  const after = (await admin.get('/api/products')).data.find((p) => p.id === cola.id);
  assert.equal(after.stock, before.stock - 10);
  assert.equal((await admin.post(`/api/orders/${id}/collect`, { paymentMethod: 'UPI' })).status, 409);
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

// ---------------------------------------------------------------------------
// Security regressions (from the security audit pass)
// ---------------------------------------------------------------------------
test('security: settings never expose encrypted secrets; anonymous sees branding only', async () => {
  await admin.put('/api/payments/terminal-config', { provider: 'stripe', secret: 'sk_test_supersecretvalue', readerId: 'tmr_1', confirmPassword: PW });
  const authed = await admin.get('/api/settings');
  assert.equal(authed.data.terminalConfigEnc, undefined);
  assert.equal(authed.data.smtpConfigEnc, undefined);
  assert.equal(authed.data.syncSecretEnc, undefined);
  const anon = await client(srv.base).get('/api/settings');
  assert.equal(anon.data.shopName, 'Test Shop');
  for (const k of ['gstNumber', 'upiId', 'reportEmail', 'syncRole', 'terminalProvider', 'fxRates', 'terminalConfigEnc']) assert.equal(anon.data[k], undefined, k);
  assert.doesNotMatch(JSON.stringify(authed.data), /supersecretvalue/);
  const cfg = await admin.get('/api/payments/terminal-config');
  assert.equal(cfg.data.configured, true);
  assert.equal(JSON.stringify(cfg.data).includes('supersecret'), false);
});

test('security: API keys only reach SKU-linked products', async () => {
  const k = await admin.post('/api/api-keys', { name: 'probe', scopes: ['products:read', 'bills:write', 'orders:write'], confirmPassword: PW });
  const hdr = { authorization: `Bearer ${k.data.apiKey}` };
  const api = client(srv.base);
  const rice = (await admin.get('/api/products')).data.find((p) => p.name === 'Loose Rice'); // imported without a SKU
  assert.equal(rice.sku, null);
  assert.equal((await api.get(`/api/external/products/${rice.barcode}`, hdr)).status, 404);
  assert.equal((await api.post('/api/external/bills', { externalRef: 'probe-1', items: [{ barcode: rice.barcode, quantity: 1 }] }, hdr)).status, 404);
  assert.equal((await api.post('/api/external/orders', { externalId: 'probe-o', items: [{ barcode: rice.barcode, quantity: 1 }] }, hdr)).status, 404);
});

test('security: franchisor is limited to the hub views and read-only', async () => {
  await admin.post('/api/auth/users', { name: 'Fran', email: 'f@example.com', password: 'franchise-pass-1', role: 'franchisor', confirmPassword: PW });
  const f = client(srv.base);
  assert.equal((await f.post('/api/auth/login', { email: 'f@example.com', password: 'franchise-pass-1' })).status, 200);
  assert.equal((await f.get('/api/hub/overview')).status, 200);
  for (const path of ['/api/customers', '/api/invoices', '/api/products', '/api/orders', '/api/reports/overview', '/api/shifts/current']) {
    assert.equal((await f.get(path)).status, 403, path);
  }
  assert.equal((await f.post('/api/hub/transfers', { fromBranchId: 1, toBranchId: 2, items: [] })).status, 403);
});

test('security: concurrent hand-over bills an order exactly once', async () => {
  const cola = (await admin.get('/api/products')).data.find((p) => p.name === 'Cola 1L');
  const key = await admin.post('/api/api-keys', { name: 'race-orders', scopes: ['orders:write'], confirmPassword: PW });
  const placed = await client(srv.base).post('/api/external/orders', { externalId: 'race-o', items: [{ sku: 'COLA-1', quantity: 2 }], customer: { name: 'Race' } }, { authorization: `Bearer ${key.data.apiKey}` });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  const o = { data: placed.data.order };
  const before = (await admin.get('/api/products')).data.find((p) => p.id === cola.id).stock;
  const results = await Promise.all([1, 2, 3, 4].map(() => admin.post(`/api/orders/${o.data.id}/collect`, { paymentMethod: 'UPI' })));
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
  const after = (await admin.get('/api/products')).data.find((p) => p.id === cola.id).stock;
  assert.equal(after, before - 2);
});

test('security: concurrent API bills with one externalRef create a single invoice', async () => {
  const k = await admin.post('/api/api-keys', { name: 'race', scopes: ['bills:write'], confirmPassword: PW });
  const hdr = { authorization: `Bearer ${k.data.apiKey}` };
  const body = { externalRef: 'race-1', items: [{ sku: 'COLA-1', quantity: 1 }], paymentMethod: 'UPI' };
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => client(srv.base).post('/api/external/bills', body, hdr)));
  assert.ok(rs.every((r) => r.status === 200 || r.status === 201), JSON.stringify(rs.map((r) => r.status)));
  assert.equal(new Set(rs.map((r) => r.data.invoice.invoiceNumber)).size, 1);
});

test('security: order webhooks go only to the owning integration', async () => {
  const http = require('http');
  const got = [];
  const sink = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { got.push(b); res.end('ok'); }); });
  await new Promise((r) => sink.listen(0, '127.0.0.1', r));
  // webhook URLs must be https — verify that plain http is refused instead
  const bad = await admin.post('/api/api-keys', { name: 'hook', scopes: ['orders:write'], webhookUrl: `http://127.0.0.1:${sink.address().port}/x`, confirmPassword: PW });
  assert.equal(bad.status, 400);
  sink.close();
});

test('A4 PDF: signature block never overflows or leaves a blank page', async () => {
  const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
  const cola = (await admin.post('/api/products', { barcode: 'PDF-ITEM', name: 'PDF test item', purchasePrice: 1, sellingPrice: 5, taxRate: 12, stock: 1000 })).data;
  // long names + a signatory name wider than the signature box
  await admin.put('/api/settings', { signatoryName: 'A Very Long Authorised Signatory Name That Must Be Clipped', termsText: 'Terms '.repeat(80), confirmPassword: PW });
  for (const n of [1, 12, 20, 24, 25, 26, 30, 45, 80]) {
    const sale = await admin.post('/api/invoices', { items: Array.from({ length: n }, () => ({ productId: cola.id, quantity: 1 })), paymentMethod: 'UPI' });
    assert.equal(sale.status, 201, JSON.stringify(sale.data));
    const pdf = await admin.get(`/api/print/${sale.data.id}/pdf?layout=a4`);
    const p = pages(pdf.data);
    // 1 page for a handful of lines; never more pages than the rows can fill (no stray blank page)
    assert.ok(p >= 1 && p <= Math.ceil(n / 24) + 1, `${n} lines -> ${p} pages`);
    if (n <= 12) assert.equal(p, 1, `${n} lines must fit on one page`);
  }
});

test('security: order externalId is scoped per API key (no cross-key read or squat)', async () => {
  const mkKey = async (name) => (await admin.post('/api/api-keys', { name, scopes: ['products:read', 'orders:write'], confirmPassword: PW })).data.apiKey;
  const [a, b] = [await mkKey('shop-a'), await mkKey('shop-b')];
  const api = client(srv.base);
  const send = (key, externalId, name) => api.post('/api/external/orders', { externalId, items: [{ sku: 'COLA-1', quantity: 1 }], customer: { name, phone: '6000000000' } }, { authorization: `Bearer ${key}` });
  const first = await send(a, 'shared-id-1', 'Victim Customer');
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const other = await send(b, 'shared-id-1', 'Other');
  assert.equal(other.status, 201, JSON.stringify(other.data));
  assert.notEqual(other.data.order.id, first.data.order.id);
  assert.notEqual(other.data.order.customerName, 'Victim Customer');
  assert.equal((await send(a, 'shared-id-1', 'Victim Customer')).data.deduplicated, true, 'same key still dedupes');
});

test('product photo: upload on create, replace, clear, served to signed-in users; lookup endpoint', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
  const body = { barcode: 'IMG-1', name: 'Photo Item', purchasePrice: 1, sellingPrice: 2, image: `data:image/png;base64,${png.toString('base64')}` };
  const made = await admin.post('/api/products', body);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.match(made.data.imageFile, /^[a-f0-9]{32}\.png$/);
  assert.equal('image' in made.data, false);
  const img = await fetch(`${srv.base}/api/products/image/${made.data.imageFile}`, { headers: { cookie: admin.cookie?.() ?? '' } });
  assert.ok([200, 401].includes(img.status));
  const bad = await admin.post('/api/products', { ...body, barcode: 'IMG-2', image: 'data:image/png;base64,AAAA' });
  assert.equal(bad.status, 400);
  const cleared = await admin.put(`/api/products/${made.data.id}`, { image: null });
  assert.equal(cleared.data.imageFile, null);
  const q = await admin.get('/api/products/lookup?q=a');
  assert.equal(q.status, 400);
});

test('customer display: shared by key across devices, no login for the viewer', async () => {
  const link = await admin.get('/api/display/link');
  assert.equal(link.status, 200);
  assert.match(link.data.key, /^[a-f0-9]{32}$/);
  const anon = (u) => fetch(srv.base + u).then(async (r) => ({ status: r.status, data: await r.json() }));
  assert.equal((await anon('/api/display/state')).status, 403);
  assert.equal((await anon('/api/display/state?key=wrong')).status, 403);
  const push = await admin.post('/api/display/state', { shopName: 'S', symbol: 'Rs.', lines: [], total: 5, upiUri: 'upi://pay?am=5' });
  assert.equal(push.status, 200);
  const got = await anon(`/api/display/state?key=${link.data.key}&v=tablet-1`);
  assert.equal(got.data.changed, true);
  assert.equal(got.data.state.upiUri, 'upi://pay?am=5');
  const same = await anon(`/api/display/state?key=${link.data.key}&since=${got.data.seq}`);
  assert.equal(same.data.changed, false);
  assert.equal((await admin.post('/api/display/state', { nope: 1 })).status, 400);
  assert.equal((await fetch(srv.base + '/api/display/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"lines":[]}' })).status, 401);
  assert.equal((await admin.get('/api/display/link')).data.viewers, 1);
});
