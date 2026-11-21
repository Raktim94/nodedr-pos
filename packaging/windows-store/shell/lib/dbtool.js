// Runs backend/src/desktop/dbtool.js under the bundled node.exe and parses its
// JSON-lines output. (better-sqlite3 is built for that Node, so the database
// work cannot run inside Electron's own Node.)
const { spawn } = require('child_process');

function runDbTool({ nodeExe, toolPath, backendDir, args, onProgress = () => {}, log = () => {} }) {
  return new Promise((resolve) => {
    const child = spawn(nodeExe, [toolPath, ...args], { cwd: backendDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let result = null;
    let errText = '';
    const handleLine = (line) => {
      if (!line.trim()) return;
      let o;
      try { o = JSON.parse(line); } catch { log(line); return; }
      if (o.event === 'progress') onProgress(o);
      else if (o.event === 'result') result = o;
    };
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.on('data', (d) => { errText += d; });
    child.on('error', (e) => resolve({ ok: false, code: 'TOOL_ERROR', message: e.message }));
    child.on('close', () => {
      if (buf) handleLine(buf);
      if (errText) log(errText.slice(-2000));
      resolve(result || { ok: false, code: 'TOOL_ERROR', message: 'The database tool stopped unexpectedly.' });
    });
  });
}
module.exports = { runDbTool };
