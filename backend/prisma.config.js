// Prisma 7 moved the Migrate/CLI connection URL out of schema.prisma and
// into this config file; the PrismaClient constructor at runtime gets its
// own adapter instance separately (see src/lib/prisma.js).
const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL || 'file:./data/pos.db',
  },
});
