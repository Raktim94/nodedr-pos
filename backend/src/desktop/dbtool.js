#!/usr/bin/env node
// CLI used by the Windows Store desktop shell (it runs under the bundled
// node.exe because better-sqlite3 is built for that Node, not for Electron).
// Prints one JSON object per line: {event:"progress",...} then {event:"result",...}.
//
//   dbtool.js prepare  --data DIR
//   dbtool.js backup   --data DIR --dest FILE.zip
//   dbtool.js inspect  --data DIR --source PATH
//   dbtool.js import   --data DIR --source PATH [--replace]
const path = require('path');
const ds = require('./datastore');

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(`--${name}`);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const dataDir = opt('data');
const migrationsDir = opt('migrations') || path.join(__dirname, '..', '..', 'prisma', 'migrations');
const appVersion = require('../../package.json').version;

(async () => {
  if (!dataDir) throw new Error('--data is required');
  let r;
  switch (cmd) {
    case 'prepare':
      r = ds.prepare({ dataDir, migrationsDir, onProgress: (p) => out({ event: 'progress', ...p }) });
      break;
    case 'backup':
      r = ds.createBackup({ dataDir, destFile: opt('dest'), appVersion });
      break;
    case 'inspect':
      r = ds.inspectSource({ source: opt('source'), migrationsDir, scratchDir: require('os').tmpdir() });
      break;
    case 'import':
      r = ds.importInto({ dataDir, source: opt('source'), migrationsDir, replace: flag('replace'), appVersion });
      break;
    default:
      throw new Error(`unknown command "${cmd}"`);
  }
  out({ event: 'result', ...r });
  process.exit(r.ok ? 0 : 2);
})().catch((err) => {
  out({ event: 'result', ok: false, code: 'TOOL_ERROR', message: String(err.message || err) });
  process.exit(3);
});
