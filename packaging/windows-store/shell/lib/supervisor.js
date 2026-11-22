// Starts and stops a child node.exe. Every child gets a stdin pipe: closing it
// (or the shell dying) makes the child's watchdog exit, and writing "shutdown"
// asks for a graceful stop. As a last resort the whole process tree is killed.
const { spawn, execFile } = require('child_process');

function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    } else {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      resolve();
    }
  });
}

function startChild({ name, command, args, cwd, env, sink, onExit }) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => sink && sink.write(d));
  child.stderr.on('data', (d) => sink && sink.write(d));
  child.stdin.on('error', () => {});
  let exited = false;
  let exitInfo = null;
  const done = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      exited = true;
      exitInfo = { code, signal };
      onExit && onExit(exitInfo);
      resolve(exitInfo);
    });
    child.on('error', (err) => {
      exited = true;
      exitInfo = { code: null, signal: null, error: err.message };
      onExit && onExit(exitInfo);
      resolve(exitInfo);
    });
  });

  return {
    name,
    child,
    pid: child.pid,
    done,
    get exited() { return exited; },
    get exitInfo() { return exitInfo; },
    async stop(graceMs = 5000) {
      if (exited) return exitInfo;
      try { child.stdin.write('shutdown\n'); } catch { /* ignore */ }
      const timer = new Promise((r) => setTimeout(() => r('timeout'), graceMs));
      if ((await Promise.race([done, timer])) === 'timeout') {
        await killTree(child.pid);
        await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
      }
      return exitInfo;
    },
    kill: () => killTree(child.pid),
  };
}

/** Poll `probe` until it returns truthy, `isAlive` turns false, or the timeout passes. */
async function waitUntil(probe, { timeoutMs, intervalMs = 200, isAlive = () => true }) {
  const end = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < end) {
    if (!isAlive()) return { ok: false, reason: 'exited', lastError };
    try {
      const v = await probe();
      if (v) return { ok: true, value: v };
    } catch (e) { lastError = e.message; }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, reason: 'timeout', lastError };
}

module.exports = { startChild, waitUntil, killTree };
