// Safe lifecycle for the Windows Store edition's SQLite database: first-run
// creation, pre-migration backup + migrate, interrupted/failed-migration
// recovery, user backup/restore (single .zip) and import from another install
// (Docker volume, earlier Store version, or a backup file).
//
// Rules this module enforces:
//  - an existing database is NEVER overwritten, reset or deleted. Anything it
//    replaces is first copied into <data>/backups or <data>/recovered;
//  - a database written by a NEWER app version (applied migrations this app does
//    not ship) is refused untouched;
//  - every failure returns { ok:false, code, message } — callers never need to
//    parse stack traces, and no secrets are ever logged.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { zipSync, unzipSync } = require('fflate');
const { listMigrations, planMigrations, applyMigrations, appliedMigrations } = require('./migrate');

const DB_FILE = 'pos.db';
const ASSET_DIRS = ['signatures', 'product-images'];
const ASSET_FILES = ['display-key'];
const REQUIRED_TABLES = ['User', 'ShopSettings', 'Product', 'Invoice'];
const KEEP_PRE_MIGRATION_BACKUPS = 5;

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const sidecars = (p) => [p, `${p}-wal`, `${p}-shm`];
const rmDb = (p) => sidecars(p).forEach((f) => fs.rmSync(f, { force: true }));
const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

function openDb(file, opts = {}) {
  return new Database(file, { timeout: 5000, ...opts });
}

function classifyOpenError(err) {
  const msg = String(err && err.message);
  if (err && (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED' || /locked|busy/i.test(msg))) {
    return fail('LOCKED', 'The database is in use by another program. Close any other NodeDR POS window and try again.');
  }
  if (err && (err.code === 'SQLITE_NOTADB' || err.code === 'SQLITE_CORRUPT' || /not a database|malformed/i.test(msg))) {
    return fail('CORRUPT', 'The database file is damaged and was left untouched.');
  }
  return fail('OPEN_FAILED', `The database could not be opened: ${msg}`);
}

/** Consistent single-file snapshot (includes uncommitted-to-main WAL content). */
function snapshotDb(srcFile, destFile, openOpts = {}) {
  fs.rmSync(destFile, { force: true });
  const db = openDb(srcFile, { fileMustExist: true, ...openOpts });
  try {
    db.exec(`VACUUM INTO '${destFile.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

function integrity(file) {
  const db = openDb(file, { fileMustExist: true, readonly: true });
  try {
    return db.pragma('quick_check', { simple: true }) === 'ok';
  } finally {
    db.close();
  }
}

/** Throws unless the DB has the core tables and they can be read. */
function verifyReadable(db) {
  const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  for (const t of REQUIRED_TABLES) {
    if (!have.has(t)) throw new Error(`table "${t}" is missing`);
    db.prepare(`SELECT count(*) FROM "${t}"`).get();
  }
}

function summarize(file) {
  const db = openDb(file, { fileMustExist: true, readonly: true });
  try {
    const count = (t) => { try { return db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n; } catch { return 0; } };
    let shopName = null;
    try { shopName = db.prepare('SELECT shopName FROM ShopSettings ORDER BY id LIMIT 1').get()?.shopName ?? null; } catch { /* ignore */ }
    return { shopName, users: count('User'), products: count('Product'), invoices: count('Invoice'), customers: count('Customer'), migrations: appliedMigrations(db).map((m) => m.name) };
  } finally {
    db.close();
  }
}

function pruneBackups(dir, prefix, keep) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
  files.slice(0, Math.max(0, files.length - keep)).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
}

// ---------------------------------------------------------------------------
// prepare: make <dataDir>/pos.db exist, be healthy and be current.
// ---------------------------------------------------------------------------
function prepare({ dataDir, migrationsDir, onProgress = () => {}, now = () => new Date() }) {
  const dbPath = path.join(dataDir, DB_FILE);
  const marker = path.join(dataDir, 'migration.inprogress.json');
  const backupsDir = path.join(dataDir, 'backups');
  const recoveredDir = path.join(dataDir, 'recovered');
  fs.mkdirSync(backupsDir, { recursive: true });
  const shipped = listMigrations(migrationsDir);
  let recovered = false;

  rmDb(`${dbPath}.initializing`); // an interrupted first run leaves nothing usable

  // An earlier run died between "backup taken" and "migration finished":
  // the half-migrated file is set aside and the pre-migration copy restored.
  if (fs.existsSync(marker)) {
    onProgress({ phase: 'recover', message: 'Recovering from an interrupted update…' });
    let m = null;
    try { m = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { /* unreadable marker: handled below */ }
    if (!m || !m.backup || !fs.existsSync(m.backup)) {
      return fail('RECOVERY_FAILED', 'An earlier update was interrupted and its backup could not be found. Your database was not modified; contact support.', { data: dataDir });
    }
    fs.mkdirSync(recoveredDir, { recursive: true });
    if (fs.existsSync(dbPath)) {
      fs.renameSync(dbPath, path.join(recoveredDir, `pos-interrupted-${stamp(now())}.db`));
      ['-wal', '-shm'].forEach((s) => fs.rmSync(dbPath + s, { force: true }));
    }
    fs.copyFileSync(m.backup, dbPath);
    fs.rmSync(marker, { force: true });
    recovered = true;
  }

  // ---- first run -----------------------------------------------------------
  if (!fs.existsSync(dbPath)) {
    onProgress({ phase: 'create', message: 'Setting up your database…' });
    const tmp = `${dbPath}.initializing`;
    let db;
    try {
      db = openDb(tmp);
      db.pragma('journal_mode = WAL');
      applyMigrations(db, shipped, (p) => onProgress({ phase: 'migrate', message: `Setting up your database (${p.step}/${p.total})…`, ...p }));
      verifyReadable(db);
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      db = null;
      rmDb(dbPath);
      fs.renameSync(tmp, dbPath);
      ['-wal', '-shm'].forEach((s) => fs.rmSync(tmp + s, { force: true }));
    } catch (err) {
      try { db && db.close(); } catch { /* ignore */ }
      rmDb(tmp);
      return fail('INIT_FAILED', `The database could not be created: ${err.message}`);
    }
    return { ok: true, state: 'created', applied: shipped.map((m) => m.name), recovered };
  }

  // ---- existing database -----------------------------------------------------
  let db;
  try {
    db = openDb(dbPath, { fileMustExist: true });
  } catch (err) {
    return classifyOpenError(err);
  }
  let plan;
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok') {
      db.close();
      return fail('CORRUPT', 'The database failed its integrity check and was left untouched. Restore a backup from the NodeDR POS menu.', { data: dataDir });
    }
    plan = planMigrations(db, shipped);
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    return classifyOpenError(err);
  }

  if (plan.unknown.length) {
    db.close();
    return fail('NEWER_DB', 'This database was created by a newer version of NodeDR POS. It was left untouched — update the app from the Microsoft Store.', { unknown: plan.unknown });
  }

  if (!plan.pending.length) {
    try { verifyReadable(db); } catch (err) {
      db.close();
      return fail('CORRUPT', `The database is missing expected data (${err.message}) and was left untouched.`);
    }
    db.close();
    return { ok: true, state: 'ready', applied: [], recovered };
  }

  // ---- migrate, with a recoverable backup taken first ----------------------
  onProgress({ phase: 'backup', message: 'Backing up your data before updating…' });
  const last = appliedMigrations(db).map((m) => m.name).pop() || 'empty';
  const backup = path.join(backupsDir, `pos-pre-migration-${stamp(now())}-from-${last.slice(0, 14)}.db`);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    snapshotDb(dbPath, backup);
    if (!integrity(backup)) throw new Error('backup failed verification');
  } catch (err) {
    fs.rmSync(backup, { force: true });
    return fail('BACKUP_FAILED', `Could not back up the database before updating, so it was not changed: ${err.message}`);
  }
  fs.writeFileSync(marker, JSON.stringify({ backup, startedAt: now().toISOString(), pending: plan.pending.map((m) => m.name) }));

  try {
    db = openDb(dbPath, { fileMustExist: true });
    applyMigrations(db, plan.pending, (p) => onProgress({ phase: 'migrate', message: `Updating your database (${p.step}/${p.total})…`, ...p }));
    verifyReadable(db);
    const fk = db.pragma('foreign_key_check');
    if (fk.length) onProgress({ phase: 'warn', message: `foreign key check reported ${fk.length} row(s)` });
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    // Prove the upgraded file reads back before reporting success.
    const check = openDb(dbPath, { fileMustExist: true, readonly: true });
    try { verifyReadable(check); } finally { check.close(); }
    fs.rmSync(marker, { force: true });
    pruneBackups(backupsDir, 'pos-pre-migration-', KEEP_PRE_MIGRATION_BACKUPS);
    return { ok: true, state: 'migrated', applied: plan.pending.map((m) => m.name), backup, recovered };
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    fs.mkdirSync(recoveredDir, { recursive: true });
    const failed = path.join(recoveredDir, `pos-failed-migration-${stamp(now())}.db`);
    try {
      fs.renameSync(dbPath, failed);
      ['-wal', '-shm'].forEach((s) => fs.rmSync(dbPath + s, { force: true }));
      fs.copyFileSync(backup, dbPath);
      fs.rmSync(marker, { force: true });
    } catch (restoreErr) {
      return fail('RECOVERY_FAILED', `The update failed (${err.message}) and the automatic rollback also failed (${restoreErr.message}). Your backup is at ${backup}.`, { backup });
    }
    return fail('MIGRATION_FAILED', `The database update failed and your previous data was restored: ${err.message}`, { backup, failedCopy: failed });
  }
}

// ---------------------------------------------------------------------------
// Backup (zip) / stage + inspect (zip | raw .db | folder)
// ---------------------------------------------------------------------------
function collectAssets(dataDir) {
  const files = {};
  const walk = (rel) => {
    const abs = path.join(dataDir, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) files[r] = fs.readFileSync(path.join(dataDir, r));
    }
  };
  ASSET_DIRS.forEach(walk);
  ASSET_FILES.forEach((f) => {
    if (fs.existsSync(path.join(dataDir, f))) files[f] = fs.readFileSync(path.join(dataDir, f));
  });
  return files;
}

function createBackup({ dataDir, destFile, appVersion = 'unknown', now = () => new Date() }) {
  const dbPath = path.join(dataDir, DB_FILE);
  if (!fs.existsSync(dbPath)) return fail('NO_DATABASE', 'There is no database to back up yet.');
  const tmpDb = path.join(dataDir, `.backup-${process.pid}.db`);
  try {
    snapshotDb(dbPath, tmpDb, { timeout: 10000 });
    const manifest = { format: 1, app: 'NodeDR POS', appVersion, createdAt: now().toISOString(), migrations: summarize(tmpDb).migrations };
    const entries = {
      'manifest.json': Buffer.from(JSON.stringify(manifest, null, 2)),
      [DB_FILE]: fs.readFileSync(tmpDb),
      ...collectAssets(dataDir),
    };
    const zipped = zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, new Uint8Array(v)])), { level: 6 });
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    const part = `${destFile}.part`;
    fs.writeFileSync(part, zipped);
    fs.renameSync(part, destFile);
    return { ok: true, file: destFile, bytes: zipped.length };
  } catch (err) {
    return classifyOpenError(err).code === 'OPEN_FAILED' ? fail('BACKUP_FAILED', `Backup failed: ${err.message}`) : classifyOpenError(err);
  } finally {
    fs.rmSync(tmpDb, { force: true });
  }
}

const SAFE_ENTRY = /^(manifest\.json|pos\.db|display-key|(signatures|product-images)\/[^/\\]+(\/[^/\\]+)*)$/;

/** Copy a source (zip, raw db file, or folder) into a scratch folder with a normalised layout. */
function stageSource(source, stageDir) {
  fs.mkdirSync(stageDir, { recursive: true });
  const st = fs.statSync(source);
  if (st.isDirectory()) {
    const dbName = fs.readdirSync(source).find((f) => f.toLowerCase() === DB_FILE);
    if (!dbName) return fail('NO_DATABASE', 'That folder does not contain a pos.db file.');
    sidecars(path.join(source, dbName)).forEach((f) => {
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(stageDir, path.basename(f).replace(dbName, DB_FILE)));
    });
    ASSET_DIRS.forEach((d) => fs.existsSync(path.join(source, d)) && fs.cpSync(path.join(source, d), path.join(stageDir, d), { recursive: true }));
    ASSET_FILES.forEach((f) => fs.existsSync(path.join(source, f)) && fs.copyFileSync(path.join(source, f), path.join(stageDir, f)));
    return { ok: true };
  }
  const head = Buffer.alloc(16);
  const fd = fs.openSync(source, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head[0] === 0x50 && head[1] === 0x4b) {
    let entries;
    try { entries = unzipSync(new Uint8Array(fs.readFileSync(source))); } catch { return fail('BAD_BACKUP', 'That file is not a valid NodeDR POS backup.'); }
    if (!entries[DB_FILE]) return fail('BAD_BACKUP', 'That backup does not contain a database.');
    for (const [name, data] of Object.entries(entries)) {
      if (name.endsWith('/')) continue;
      if (!SAFE_ENTRY.test(name)) continue; // ignore anything unexpected; never write outside stageDir
      const out = path.join(stageDir, ...name.split('/'));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, data);
    }
    return { ok: true };
  }
  if (head.toString('latin1', 0, 15) !== 'SQLite format 3') return fail('BAD_BACKUP', 'That file is not a NodeDR POS backup or database.');
  fs.copyFileSync(source, path.join(stageDir, DB_FILE));
  ['-wal', '-shm'].forEach((s) => fs.existsSync(source + s) && fs.copyFileSync(source + s, path.join(stageDir, DB_FILE + s)));
  return { ok: true };
}

function inspectStage(stageDir, migrationsDir) {
  const file = path.join(stageDir, DB_FILE);
  let summary;
  try {
    if (!integrity(file)) return fail('CORRUPT', 'That database failed its integrity check, so it was not used.');
    summary = summarize(file);
    const db = openDb(file, { fileMustExist: true, readonly: true });
    try { verifyReadable(db); } finally { db.close(); }
  } catch (err) {
    return fail('BAD_BACKUP', `That database is not a NodeDR POS database: ${err.message}`);
  }
  const known = new Set(listMigrations(migrationsDir).map((m) => m.name));
  const unknown = summary.migrations.filter((m) => !known.has(m));
  if (unknown.length) return fail('NEWER_DB', 'That data was created by a newer version of NodeDR POS than this one. Update the app first.', { unknown });
  return { ok: true, summary };
}

/** Read-only look at a candidate source, for the confirmation screen. */
function inspectSource({ source, migrationsDir, scratchDir }) {
  const stage = fs.mkdtempSync(path.join(scratchDir, 'inspect-'));
  try {
    const s = stageSource(source, stage);
    if (!s.ok) return s;
    return inspectStage(stage, migrationsDir);
  } catch (err) {
    return fail('BAD_BACKUP', `Could not read that source: ${err.message}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * Replace this install's data with `source` (restore or import).
 * The backend must be stopped. Existing data is only replaced when `replace` is
 * true, and is always preserved first in <data>/backups/pre-import-*.zip (or,
 * if it is too damaged to zip, as a raw file copy).
 */
function importInto({ dataDir, source, migrationsDir, replace = false, appVersion, now = () => new Date() }) {
  const dbPath = path.join(dataDir, DB_FILE);
  const backupsDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const stage = fs.mkdtempSync(path.join(dataDir, '.stage-'));
  try {
    const s = stageSource(source, stage);
    if (!s.ok) return s;
    const insp = inspectStage(stage, migrationsDir);
    if (!insp.ok) return insp;

    let safety = null;
    if (fs.existsSync(dbPath)) {
      const cur = (() => { try { return summarize(dbPath); } catch { return null; } })();
      const destNewer = !!cur && cur.migrations.some((m) => !insp.summary.migrations.includes(m));
      if (!replace) {
        return fail('DEST_EXISTS', 'This install already has data. Importing would replace it.', { current: cur, incoming: insp.summary, destNewer });
      }
      const zip = path.join(backupsDir, `pre-import-${stamp(now())}.zip`);
      const made = createBackup({ dataDir, destFile: zip, appVersion, now });
      if (made.ok) safety = zip;
      else {
        safety = path.join(backupsDir, `pre-import-${stamp(now())}-raw.db`);
        fs.copyFileSync(dbPath, safety);
      }
    }

    const incoming = path.join(dataDir, `${DB_FILE}.importing`);
    snapshotDb(path.join(stage, DB_FILE), incoming); // collapses any -wal in the source into one clean file
    rmDb(dbPath);
    fs.renameSync(incoming, dbPath);
    ASSET_DIRS.forEach((d) => {
      fs.rmSync(path.join(dataDir, d), { recursive: true, force: true });
      if (fs.existsSync(path.join(stage, d))) fs.cpSync(path.join(stage, d), path.join(dataDir, d), { recursive: true });
    });
    ASSET_FILES.forEach((f) => {
      if (fs.existsSync(path.join(stage, f))) fs.copyFileSync(path.join(stage, f), path.join(dataDir, f));
    });
    return { ok: true, summary: insp.summary, safetyBackup: safety };
  } catch (err) {
    return fail('IMPORT_FAILED', `Import failed: ${err.message}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(path.join(dataDir, `${DB_FILE}.importing`), { force: true });
  }
}

module.exports = { DB_FILE, prepare, createBackup, importInto, inspectSource, summarize, integrity, classifyOpenError };
