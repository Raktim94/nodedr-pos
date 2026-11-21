// Backend entry point used by the Windows Store desktop shell. Same server as
// Docker (src/server.js), plus: stop when the shell goes away (watchdog) and
// fold the SQLite WAL back into pos.db on the way out.
require('./watchdog');
global.__nodedrShutdownHook = async () => {
  const prisma = require('../lib/prisma');
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
  await prisma.$disconnect();
};
require('../server');
