const { httpError } = require('./http');

const MAX_ENTRIES = 500;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

// An .xlsx is a zip, and a small crafted one can inflate to gigabytes. Before
// anything unzips it, read the sizes the archive declares in its central
// directory and refuse one that claims too much. Declared sizes can lie, but
// the unzipper checks them against what it actually inflates.
function assertSafeZip(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || buffer.length < eocd + 22) throw httpError('That file is not a valid .xlsx workbook', 400);
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff) throw httpError('That workbook is too large to import', 400);
  if (entries > MAX_ENTRIES) throw httpError('That workbook has too many parts to import', 400);

  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw httpError('That file is not a valid .xlsx workbook', 400);
    const size = buffer.readUInt32LE(offset + 24);
    if (size === 0xffffffff || size > MAX_ENTRY_BYTES) throw httpError('That workbook is too large to import', 400);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw httpError('That workbook is too large to import', 400);
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

module.exports = { assertSafeZip };
