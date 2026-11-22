const test = require('node:test');
const assert = require('node:assert/strict');
const { usesSpanishInvoices, verifactuActive, supportsUpi, withCountryPrefix } = require('../src/lib/region');

test('VERI*FACTU needs both the switch and a euro shop; Spanish wording follows the switch', () => {
  assert.equal(verifactuActive({ vfEnabled: true, currencyCode: 'EUR' }), true);
  assert.equal(verifactuActive({ vfEnabled: true, currencyCode: 'INR' }), false);
  assert.equal(verifactuActive({ vfEnabled: false, currencyCode: 'EUR' }), false);
  assert.equal(verifactuActive(null), false);
  assert.equal(usesSpanishInvoices({ vfEnabled: true }), true);
  assert.equal(usesSpanishInvoices({ vfEnabled: false }), false);
});

test('UPI only for rupee shops; India prefix only on 10-digit numbers from rupee shops', () => {
  assert.equal(supportsUpi({ currencyCode: 'INR' }), true);
  assert.equal(supportsUpi({ currencyCode: 'EUR' }), false);
  assert.equal(withCountryPrefix({ currencyCode: 'INR' }, '9999900000'), '919999900000');
  assert.equal(withCountryPrefix({ currencyCode: 'INR' }, '919999900000'), '919999900000');
  assert.equal(withCountryPrefix({ currencyCode: 'EUR' }, '9999900000'), '9999900000');
});
