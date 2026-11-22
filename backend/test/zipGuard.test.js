const test = require('node:test');
const assert = require('node:assert/strict');
const { zipSync } = require('fflate');
const { assertSafeZip } = require('../src/lib/zipGuard');

test('zipGuard: an ordinary workbook-sized archive passes', () => {
  const zip = Buffer.from(zipSync({ '[Content_Types].xml': new Uint8Array(2000), 'xl/worksheets/sheet1.xml': new Uint8Array(40_000) }));
  assert.doesNotThrow(() => assertSafeZip(zip));
});

test('zipGuard: a tiny archive that inflates past the cap is refused before unzipping', () => {
  const bomb = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': new Uint8Array(60 * 1024 * 1024) }));
  assert.ok(bomb.length < 200 * 1024, 'the archive itself is small');
  assert.throws(() => assertSafeZip(bomb), (e) => e.status === 400 && /too large/.test(e.message));
});

test('zipGuard: many parts, and things that are not zips, are refused', () => {
  const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`p${i}.xml`, new Uint8Array(1)]));
  assert.throws(() => assertSafeZip(Buffer.from(zipSync(many))), (e) => e.status === 400);
  assert.throws(() => assertSafeZip(Buffer.from('not a zip at all')), (e) => e.status === 400);
});
