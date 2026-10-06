const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { pngToIco, checkHealth, restartCommand } = require('../lib');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('pngToIco wraps the PNG in a valid single-image ICO', () => {
  const ico = pngToIco(PNG);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
  assert.equal(ico.readUInt32LE(14), PNG.length);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.ok(ico.subarray(22).equals(PNG));
});

test('checkHealth reflects the backend', async () => {
  let up = true;
  const srv = http.createServer((req, res) => (up ? res.end('{"status":"ok"}') : ((res.statusCode = 500), res.end('x'))));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  assert.equal(await checkHealth(url), true);
  up = false;
  assert.equal(await checkHealth(url), false);
  srv.close();
  assert.equal(await checkHealth(url, 300), false);
});

test('restart command per platform', () => {
  assert.equal(restartCommand('linux')[0], 'pkexec');
  assert.deepEqual(restartCommand('darwin', 501), ['launchctl', ['kickstart', '-k', 'gui/501/com.nodedr.pos']]);
  assert.equal(restartCommand('win32')[0], 'powershell.exe');
});
