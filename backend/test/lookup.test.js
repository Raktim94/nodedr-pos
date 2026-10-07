const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupProducts, detectMode, _clearCache } = require('../src/lib/productLookup');
const { saveProductImage, fetchRemoteProductImage, readProductImage } = require('../src/lib/productImages');

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

test('detectMode: digits are a barcode, text is a name', () => {
  assert.equal(detectMode('8901234567890'), 'barcode');
  assert.equal(detectMode('12345'), 'name');
  assert.equal(detectMode('parle g'), 'name');
});

test('name search merges sources, dedupes, drops unusable rows', async () => {
  _clearCache();
  const fetchImpl = (url) => {
    if (String(url).includes('openfoodfacts')) {
      return ok({ products: [
        { code: '111111111111', product_name: 'Biscuit', brands: 'Parle, Other', categories: 'en:Snacks,en:Biscuits', quantity: '100 g', image_front_small_url: 'https://images.openfoodfacts.org/a.jpg' },
        { code: '222222222222', product_name: '' }, // no name -> dropped
      ] });
    }
    return ok({ products: [{ code: '111111111111', product_name: 'Biscuit dup' }] });
  };
  const out = await lookupProducts('biscuit', { fetchImpl });
  assert.equal(out.mode, 'name');
  assert.equal(out.results.length, 1);
  assert.deepEqual([out.results[0].brand, out.results[0].category], ['Parle', 'Snacks']);
  assert.equal(out.warnings.length, 0);
});

test('barcode not found anywhere -> empty results, not an error', async () => {
  _clearCache();
  const out = await lookupProducts('8901234567890', { fetchImpl: () => ok({ status: 0, product: null }) });
  assert.deepEqual(out.results, []);
});

test('partial failure -> results plus a warning; total failure -> 502', async () => {
  _clearCache();
  const partial = (url) => (String(url).includes('openfoodfacts') ? ok({ products: [{ code: '333333333333', product_name: 'Tea' }] }) : Promise.reject(new Error('down')));
  const out = await lookupProducts('tea', { fetchImpl: partial });
  assert.equal(out.results.length, 1);
  assert.equal(out.warnings.length, 1);
  await assert.rejects(lookupProducts('tea2', { fetchImpl: () => Promise.reject(new Error('down')) }), (e) => e.status === 502);
  await assert.rejects(lookupProducts('tea3', { fetchImpl: () => Promise.resolve({ ok: false, status: 503 }) }), (e) => e.status === 502);
});

test('query validation', async () => {
  await assert.rejects(lookupProducts('a'), (e) => e.status === 400);
  await assert.rejects(lookupProducts('x'.repeat(101)), (e) => e.status === 400);
});

test('images: magic-number check, size cap, remote host allow-list', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
  const name = saveProductImage(`data:image/png;base64,${png.toString('base64')}`);
  assert.match(name, /^[a-f0-9]{32}\.png$/);
  assert.ok(readProductImage(name).equals(png));
  assert.throws(() => saveProductImage(Buffer.from('<html>not an image</html>').toString('base64')), (e) => e.status === 400);
  assert.throws(() => saveProductImage(Buffer.alloc(900 * 1024, 1).toString('base64')), (e) => e.status === 413);
  assert.equal(readProductImage('../../etc/passwd'), null);

  let called = false;
  const spy = () => { called = true; return Promise.reject(new Error('should not fetch')); };
  assert.equal(await fetchRemoteProductImage('https://evil.example.com/x.jpg', spy), null);
  assert.equal(await fetchRemoteProductImage('http://images.openfoodfacts.org/x.jpg', spy), null);
  assert.equal(called, false);
  const good = await fetchRemoteProductImage('https://images.openfoodfacts.org/x.png', () => Promise.resolve({ ok: true, arrayBuffer: async () => png }));
  assert.equal(good, name);
  assert.equal(await fetchRemoteProductImage('https://images.openfoodfacts.org/x.png', () => Promise.reject(new Error('net'))), null);
});
