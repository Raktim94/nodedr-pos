const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 3;

function rotate(file) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    fs.renameSync(file, `${file}.1`);
    fs.rmSync(`${file}.${KEEP}`, { force: true });
  } catch { /* logging must never break the app */ }
}

function createLogger(logDir, redact = (s) => s) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = (name) => path.join(logDir, name);
  const write = (name, line) => {
    try { fs.appendFileSync(file(name), `${new Date().toISOString()} ${redact(line)}\n`); } catch { /* ignore */ }
  };
  ['shell.log', 'backend.log', 'frontend.log', 'migration.log'].forEach((n) => rotate(file(n)));
  return {
    dir: logDir,
    file,
    info: (m) => write('shell.log', `INFO  ${m}`),
    warn: (m) => write('shell.log', `WARN  ${m}`),
    error: (m) => write('shell.log', `ERROR ${m}`),
    to: write,
    /** Open an append stream for a child process's output; lines are redacted. */
    childSink(name) {
      rotate(file(name));
      const fd = fs.openSync(file(name), 'a');
      return {
        fd,
        write: (chunk) => { try { fs.writeSync(fd, redact(String(chunk))); } catch { /* ignore */ } },
        close: () => { try { fs.closeSync(fd); } catch { /* ignore */ } },
      };
    },
  };
}
module.exports = { createLogger };
