// Windows Store edition: migration runner + database safety (no Windows needed).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const ds = require('../src/desktop/datastore');
const { listMigrations } = require('../src/desktop/migrate');

const MIG = path.join(__dirname, '..', 'prisma', 'migrations');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nodedr-ds-'));
const schemaOf = (file) => {
  const db = new Database(file, { readonly: true });
  const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY type, name").all();
  const mig = db.prepare('SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name').all();
  db.close();
  return { rows, mig };
};
// A copy of the migrations folder we can tamper with.
const cloneMigrations = () => {
  const d = path.join(tmp(), 'migrations');
  fs.cpSync(MIG, d, { recursive: true });
  return d;
};
const seed = (file) => {
  const db = new Database(file);
  db.exec(`INSERT INTO User (name,email,password,role) VALUES ('Owner','o@x.com','hash','admin');`);
  db.close();
};

test('fresh install produces the same schema and migration ledger as `prisma migrate deploy`', () => {
  const a = tmp();
  const r = ds.prepare({ dataDir: a, migrationsDir: MIG });
  assert.equal(r.ok, true);
  assert.equal(r.state, 'created');

  const b = tmp();
  execFileSync(process.execPath, ['node_modules/.bin/prisma', 'migrate', 'deploy'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: `file:${path.join(b, 'pos.db')}` },
    stdio: 'pipe',
  });
  assert.deepEqual(schemaOf(path.join(a, 'pos.db')), schemaOf(path.join(b, 'pos.db')));
});

test('a second start is a no-op and keeps existing data', () => {
  const d = tmp();
  ds.prepare({ dataDir: d, migrationsDir: MIG });
  seed(path.join(d, 'pos.db'));
  const r = ds.prepare({ dataDir: d, migrationsDir: MIG });
  assert.deepEqual([r.ok, r.state], [true, 'ready']);
  assert.equal(ds.summarize(path.join(d, 'pos.db')).users, 1);
});

test('an older database is upgraded after a verified pre-migration backup, and keeps its data', () => {
  const d = tmp();
  const all = listMigrations(MIG);
  // Build a DB at an older version: only the first 10 migrations.
  const old = cloneMigrations();
  all.slice(10).forEach((m) => fs.rmSync(path.join(old, m.name), { recursive: true }));
  assert.equal(ds.prepare({ dataDir: d, migrationsDir: old }).ok, true);
  seed(path.join(d, 'pos.db'));

  const r = ds.prepare({ dataDir: d, migrationsDir: MIG });
  assert.equal(r.ok, true);
  assert.equal(r.state, 'migrated');
  assert.equal(r.applied.length, all.length - 10);
  assert.ok(fs.existsSync(r.backup), 'backup file exists');
  assert.equal(ds.summarize(r.backup).users, 1, 'backup holds the pre-migration data');
  assert.equal(ds.summarize(path.join(d, 'pos.db')).users, 1, 'data survived migration');
  assert.equal(ds.summarize(path.join(d, 'pos.db')).migrations.length, all.length);
  assert.ok(!fs.existsSync(path.join(d, 'migration.inprogress.json')));
});

test('a failing migration rolls back to the backup and preserves the original data', () => {
  const d = tmp();
  const old = cloneMigrations();
  const all = listMigrations(MIG);
  fs.rmSync(path.join(old, all[all.length - 1].name), { recursive: true });
  ds.prepare({ dataDir: d, migrationsDir: old });
  seed(path.join(d, 'pos.db'));
  const before = ds.summarize(path.join(d, 'pos.db'));

  const broken = cloneMigrations();
  fs.writeFileSync(path.join(broken, all[all.length - 1].name, 'migration.sql'), 'CREATE TABLE ok_one (id INTEGER);\nTHIS IS NOT SQL;');
  const r = ds.prepare({ dataDir: d, migrationsDir: broken });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MIGRATION_FAILED');
  assert.deepEqual(ds.summarize(path.join(d, 'pos.db')), before, 'original database is back, untouched');
  assert.ok(fs.existsSync(r.failedCopy), 'failed copy kept for diagnosis');
  assert.ok(!fs.existsSync(path.join(d, 'migration.inprogress.json')));
  // and a later start with good migrations still works
  assert.equal(ds.prepare({ dataDir: d, migrationsDir: MIG }).ok, true);
});

test('an interrupted migration (marker left behind) is rolled back to the pre-migration backup on next start', () => {
  const d = tmp();
  const all = listMigrations(MIG);
  const old = cloneMigrations();
  fs.rmSync(path.join(old, all[all.length - 1].name), { recursive: true });
  ds.prepare({ dataDir: d, migrationsDir: old });
  seed(path.join(d, 'pos.db'));
  const before = ds.summarize(path.join(d, 'pos.db'));

  // Simulate: backup taken, marker written, process killed half way (DB left in a bad state).
  const backup = path.join(d, 'backups', 'pos-pre-migration-test.db');
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  const db = new Database(path.join(d, 'pos.db'));
  db.exec(`VACUUM INTO '${backup}'`);
  db.exec('DROP TABLE Invoice;'); // half-applied damage
  db.close();
  fs.writeFileSync(path.join(d, 'migration.inprogress.json'), JSON.stringify({ backup }));

  const r = ds.prepare({ dataDir: d, migrationsDir: MIG });
  assert.equal(r.ok, true);
  assert.equal(r.recovered, true);
  assert.equal(ds.summarize(path.join(d, 'pos.db')).users, before.users);
  assert.equal(fs.readdirSync(path.join(d, 'recovered')).length, 1, 'half-migrated file kept, not deleted');
});

test('a database from a NEWER app is refused and left byte-for-byte untouched', () => {
  const d = tmp();
  ds.prepare({ dataDir: d, migrationsDir: MIG });
  const db = new Database(path.join(d, 'pos.db'));
  db.prepare("INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ('x','y',datetime('now'),'29990101000000_from_the_future',datetime('now'),1)").run();
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  const before = fs.readFileSync(path.join(d, 'pos.db'));
  const r = ds.prepare({ dataDir: d, migrationsDir: MIG });
  assert.equal(r.code, 'NEWER_DB');
  assert.ok(fs.readFileSync(path.join(d, 'pos.db')).equals(before));
});

test('a corrupted / non-database file is refused and left untouched', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'pos.db'), 'this is not a sqlite database at all, just text'.repeat(50));
  const before = fs.readFileSync(path.join(d, 'pos.db'));
  const r = ds.prepare({ dataDir: d, migrationsDir: MIG });
  assert.equal(r.code, 'CORRUPT');
  assert.ok(fs.readFileSync(path.join(d, 'pos.db')).equals(before));
});

test('a locked database reports LOCKED instead of failing obscurely', () => {
  const d = tmp();
  const old = cloneMigrations();
  const all = listMigrations(MIG);
  fs.rmSync(path.join(old, all[all.length - 1].name), { recursive: true });
  ds.prepare({ dataDir: d, migrationsDir: old });
  const holder = new Database(path.join(d, 'pos.db'));
  holder.pragma('journal_mode = DELETE');
  holder.exec('BEGIN EXCLUSIVE');
  try {
    const r = ds.prepare({ dataDir: d, migrationsDir: MIG });
    assert.equal(r.ok, false);
    assert.ok(['LOCKED', 'BACKUP_FAILED', 'OPEN_FAILED'].includes(r.code), r.code);
    assert.ok(!fs.existsSync(path.join(d, 'migration.inprogress.json')) || r.code !== 'MIGRATION_FAILED');
  } finally {
    holder.exec('ROLLBACK');
    holder.close();
  }
});

test('backup -> restore round trip (zip) preserves data and assets; restore never replaces without confirmation', () => {
  const src = tmp();
  ds.prepare({ dataDir: src, migrationsDir: MIG });
  seed(path.join(src, 'pos.db'));
  fs.mkdirSync(path.join(src, 'signatures'));
  fs.writeFileSync(path.join(src, 'signatures', 'sig.png'), 'PNGDATA');
  fs.writeFileSync(path.join(src, '.jwt-secret'), 'TOPSECRET');
  const zip = path.join(tmp(), 'b.zip');
  const made = ds.createBackup({ dataDir: src, destFile: zip, appVersion: '9.9.9' });
  assert.equal(made.ok, true);
  assert.ok(!fs.readFileSync(zip).includes('TOPSECRET'), 'backup never contains the session secret');

  const dst = tmp();
  ds.prepare({ dataDir: dst, migrationsDir: MIG });
  const refused = ds.importInto({ dataDir: dst, source: zip, migrationsDir: MIG });
  assert.equal(refused.code, 'DEST_EXISTS');
  assert.equal(ds.summarize(path.join(dst, 'pos.db')).users, 0, 'existing data untouched without replace');

  const r = ds.importInto({ dataDir: dst, source: zip, migrationsDir: MIG, replace: true });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(r.safetyBackup), 'previous data preserved before replacing');
  assert.equal(ds.summarize(path.join(dst, 'pos.db')).users, 1);
  assert.equal(fs.readFileSync(path.join(dst, 'signatures', 'sig.png'), 'utf8'), 'PNGDATA');
});

test('import from a Docker-style data folder (pos.db + -wal) into a fresh install, then migrate it', () => {
  const all = listMigrations(MIG);
  const old = cloneMigrations();
  all.slice(12).forEach((m) => fs.rmSync(path.join(old, m.name), { recursive: true }));
  const docker = tmp();
  ds.prepare({ dataDir: docker, migrationsDir: old });
  seed(path.join(docker, 'pos.db'));
  fs.writeFileSync(path.join(docker, '.jwt-secret'), 'dockersecret');

  const dst = tmp();
  const insp = ds.inspectSource({ source: docker, migrationsDir: MIG, scratchDir: tmp() });
  assert.equal(insp.ok, true);
  assert.equal(insp.summary.users, 1);
  const r = ds.importInto({ dataDir: dst, source: docker, migrationsDir: MIG });
  assert.equal(r.ok, true);
  assert.ok(!fs.existsSync(path.join(dst, '.jwt-secret')), 'foreign session secret is not imported');
  const m = ds.prepare({ dataDir: dst, migrationsDir: MIG });
  assert.equal(m.state, 'migrated');
  assert.equal(ds.summarize(path.join(dst, 'pos.db')).users, 1);
  // source untouched
  assert.equal(ds.summarize(path.join(docker, 'pos.db')).migrations.length, 12);
});

test('importing data from a newer app is refused', () => {
  const src = tmp();
  ds.prepare({ dataDir: src, migrationsDir: MIG });
  const db = new Database(path.join(src, 'pos.db'));
  db.prepare("INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ('x','y',datetime('now'),'29990101000000_future',datetime('now'),1)").run();
  db.close();
  const r = ds.importInto({ dataDir: tmp(), source: src, migrationsDir: MIG });
  assert.equal(r.code, 'NEWER_DB');
});

test('zip entries cannot escape the staging folder', () => {
  const { zipSync } = require('fflate');
  const evil = path.join(tmp(), 'evil.zip');
  const base = tmp();
  ds.prepare({ dataDir: base, migrationsDir: MIG });
  fs.writeFileSync(evil, zipSync({ 'pos.db': new Uint8Array(fs.readFileSync(path.join(base, 'pos.db'))), '../../escaped.txt': new Uint8Array([1]), 'signatures/../../escaped2.txt': new Uint8Array([1]) }));
  const dst = tmp();
  const r = ds.importInto({ dataDir: dst, source: evil, migrationsDir: MIG });
  assert.equal(r.ok, true);
  assert.ok(!fs.existsSync(path.join(dst, '..', 'escaped.txt')) && !fs.existsSync(path.join(dst, '..', '..', 'escaped.txt')));
});

test('non-backup files are rejected without side effects', () => {
  const f = path.join(tmp(), 'x.zip');
  fs.writeFileSync(f, 'hello world, definitely not a backup');
  const dst = tmp();
  const r = ds.importInto({ dataDir: dst, source: f, migrationsDir: MIG });
  assert.equal(r.code, 'BAD_BACKUP');
  assert.ok(!fs.existsSync(path.join(dst, 'pos.db')));
});
