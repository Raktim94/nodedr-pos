// The support report shown on the error screen / Diagnostics window. Contains
// versions, paths and sizes only — never secrets, cookies or business data.
const fs = require('fs');
const path = require('path');
const os = require('os');

const size = (p) => { try { return fs.statSync(p).size; } catch { return null; } };
const tail = (file, n, redact) => {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    return lines.slice(-n).map(redact).join('\n');
  } catch { return '(no log)'; }
};

function buildReport({ appVersion, electronVersion, dataDir, dataKind, packageFamily, logDir, ports, state, error, redact }) {
  const db = path.join(dataDir, 'pos.db');
  const backups = (() => { try { return fs.readdirSync(path.join(dataDir, 'backups')).length; } catch { return 0; } })();
  const lines = [
    `NodeDR POS ${appVersion} (Microsoft Store edition)`,
    `Time: ${new Date().toISOString()}`,
    `Windows: ${os.type()} ${os.release()} ${os.arch()}`,
    `Electron: ${electronVersion || 'n/a'}`,
    `Package family: ${packageFamily || '(not packaged)'}`,
    `State: ${state || 'unknown'}`,
    error ? `Error: ${error.code || ''} ${error.message || error}` : null,
    `Data folder (${dataKind}): ${dataDir}`,
    `Logs folder: ${logDir}`,
    `Database: ${db} (${size(db) ?? 'missing'} bytes), backups kept: ${backups}`,
    `Ports: ${JSON.stringify(ports || {})}`,
    '',
    '--- shell.log (last 40 lines) ---',
    tail(path.join(logDir, 'shell.log'), 40, redact),
    '',
    '--- backend.log (last 30 lines) ---',
    tail(path.join(logDir, 'backend.log'), 30, redact),
  ];
  return redact(lines.filter((l) => l !== null).join('\n'));
}

module.exports = { buildReport };
