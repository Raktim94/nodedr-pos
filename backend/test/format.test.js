const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney, esc, csvCell } = require('../src/lib/format');

test('formatMoney: symbol, space, two decimals', () => {
  assert.equal(formatMoney('Rs.', 1234.5), 'Rs. 1234.50');
  assert.equal(formatMoney('€', '7'), '€ 7.00');
});

test('esc: HTML-significant characters are escaped, nullish becomes empty', () => {
  assert.equal(esc(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('csvCell: quotes awkward values and defuses spreadsheet formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"');
  for (const bad of ['+1+1', '-2+3', '@SUM(A1)', '\tcmd']) assert.ok(csvCell(bad).startsWith("'"), bad);
  assert.equal(csvCell(-5), '-5'); // a real number
  assert.equal(csvCell('-12.50'), '-12.50'); // a numeric string
  assert.equal(csvCell('+91 98765-43210'), '+91 98765-43210'); // a phone number
  assert.equal(csvCell(null), '');
});
