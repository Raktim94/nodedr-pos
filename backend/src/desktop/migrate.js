// Prisma-compatible migration runner for the Windows Store edition.
//
// The Store package ships no Prisma CLI / schema engine (it would add ~100 MB
// and spawn a second process that writes next to the read-only install
// directory). This applies the SAME prisma/migrations/*/migration.sql files and
// records them in the SAME `_prisma_migrations` table, with Prisma's checksum
// (sha256 of the SQL), so a database written here is indistinguishable from
// `prisma migrate deploy` output — a Docker install can adopt it and vice
// versa. test/desktop.migrate.test.js compares the resulting schema with the
// one `prisma migrate deploy` produces.
//
// Migrations are executed exactly as Prisma does: as one script, with NO
// wrapping transaction (Prisma's table-redefinition migrations rely on
// `PRAGMA foreign_keys=OFF`, which SQLite ignores inside a transaction).
// Atomicity therefore comes from the caller's pre-migration file backup.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

function listMigrations(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'migration.sql')))
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
      return { name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
    });
}

function hasMigrationsTable(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'").get();
}

function appliedMigrations(db) {
  if (!hasMigrationsTable(db)) return [];
  return db
    .prepare('SELECT migration_name AS name, checksum, finished_at AS finishedAt, rolled_back_at AS rolledBackAt FROM _prisma_migrations ORDER BY migration_name')
    .all()
    .filter((r) => r.finishedAt && !r.rolledBackAt);
}

/**
 * Compare a database with the migrations this app ships.
 *  - pending:         shipped but not applied yet
 *  - unknown:         applied in the DB but not shipped (DB comes from a NEWER app)
 *  - modified:        applied, but its SQL changed since (informational)
 *  - incomplete:      a migration that started but never finished (interrupted)
 */
function planMigrations(db, shipped) {
  const applied = appliedMigrations(db);
  const appliedNames = new Set(applied.map((a) => a.name));
  const shippedByName = new Map(shipped.map((m) => [m.name, m]));
  const incomplete = hasMigrationsTable(db)
    ? db.prepare('SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL').all().map((r) => r.name)
    : [];
  return {
    pending: shipped.filter((m) => !appliedNames.has(m.name)),
    unknown: applied.filter((a) => !shippedByName.has(a.name)).map((a) => a.name),
    modified: applied.filter((a) => shippedByName.has(a.name) && shippedByName.get(a.name).checksum !== a.checksum).map((a) => a.name),
    incomplete,
  };
}

function applyMigrations(db, pending, onProgress = () => {}) {
  db.exec(MIGRATIONS_TABLE_DDL);
  const insert = db.prepare(
    `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
     VALUES (?, ?, ?, ?, NULL, ?, 1)`
  );
  pending.forEach((m, i) => {
    onProgress({ step: i + 1, total: pending.length, name: m.name });
    const started = new Date().toISOString();
    db.exec(m.sql);
    insert.run(crypto.randomUUID(), m.checksum, new Date().toISOString(), m.name, started);
  });
}

module.exports = { MIGRATIONS_TABLE_DDL, listMigrations, appliedMigrations, planMigrations, applyMigrations, hasMigrationsTable };
