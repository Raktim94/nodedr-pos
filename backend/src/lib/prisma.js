const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

// Prisma 7 requires an explicit driver adapter at runtime instead of
// reading the connection string from schema.prisma (that now only lives
// in prisma.config.js, used by the CLI/Migrate). better-sqlite3 ships
// prebuilt binaries for linux-musl (Alpine), so this needs no native
// build toolchain in the Docker image.
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./data/pos.db',
});

const prisma = new PrismaClient({ adapter });

// SQLite tuning for a busy till: WAL lets reads (dashboard, API) proceed
// while a checkout writes; NORMAL sync is safe under WAL and much faster;
// a busy timeout turns brief lock contention into a short wait, not an error.
// Pragmas are issued once per process — WAL mode is persisted in the DB file.
prisma
  .$queryRawUnsafe('PRAGMA journal_mode = WAL')
  .then(() => prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL'))
  .then(() => prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000'))
  .then(() => prisma.$queryRawUnsafe('PRAGMA temp_store = MEMORY'))
  .catch((err) => console.error('sqlite pragma setup failed:', err.message));

module.exports = prisma;
