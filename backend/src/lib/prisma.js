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

module.exports = prisma;
