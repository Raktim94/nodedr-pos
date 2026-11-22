const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney, esc } = require('../src/lib/format');

test('formatMoney: symbol, space, two decimals', () => {
  assert.equal(formatMoney('Rs.', 1234.5), 'Rs. 1234.50');
  assert.equal(formatMoney('€', '7'), '€ 7.00');
});

test('esc: HTML-significant characters are escaped, nullish becomes empty', () => {
  assert.equal(esc(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});
