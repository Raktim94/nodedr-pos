// NodeDR POS — Microsoft Store desktop shell.
//
// Opens the existing POS (Next.js frontend + Node/Express/SQLite backend) in a
// normal desktop window. Everything runs locally and offline, bound to
// 127.0.0.1, with no service, no admin rights and no browser:
//
//   Electron window ──> gateway (this process, 127.0.0.1:1994x)
//                         ├─ /api, /mcp ─> backend  (bundled node.exe, 127.0.0.1:random)
//                         └─ everything else ─> Next.js (bundled node.exe, 127.0.0.1:random)
//
// Both node.exe children are owned by this process: they stop when the window
// closes, and exit by themselves (stdin watchdog) if this process is killed.
'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { resolveDataDir } = require('./lib/paths');
const { makeRedactor } = require('./lib/redact');
const { createLogger } = require('./lib/logger');
const { startChild, waitUntil } = require('./lib/supervisor');
const { createGateway, pingNonce, freeLoopbackPort } = require('./lib/gateway');
const { runDbTool } = require('./lib/dbtool');
const { findLegacyStore, findDockerVolumes } = require('./lib/candidates');
const { buildReport } = require('./lib/diagnostics');
const settings = require('./lib/settings');

const APP_NAME = 'NodeDR POS';
const PREFERRED_PORTS = [19940, 19941, 19942, 19943, 19944, 19945, 19946, 19947, 19948, 19949];
const SPLASH = path.join(__dirname, 'splash.html');
const SITE = 'https://pos.nodedr.com';

// ---- paths -----------------------------------------------------------------
const where = resolveDataDir();
const DATA_DIR = where.dir;
fs.mkdirSync(DATA_DIR, { recursive: true });
const PAYLOAD = process.env.NODEDR_PAYLOAD || path.join(process.resourcesPath, 'nodedr');
const NODE_EXE = path.join(PAYLOAD, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const BACKEND_DIR = path.join(PAYLOAD, 'backend');
const FRONTEND_DIR = path.join(PAYLOAD, 'frontend');
const DBTOOL = path.join(BACKEND_DIR, 'src', 'desktop', 'dbtool.js');
const WATCHDOG = path.join(BACKEND_DIR, 'src', 'desktop', 'watchdog.js');
const ENTRY = path.join(BACKEND_DIR, 'src', 'desktop', 'entry.js');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const DB_FILE = path.join(DATA_DIR, 'pos.db');

// Chromium's own profile (cache, localStorage, cookies) lives beside the data, not in virtualised AppData.
app.setPath('userData', path.join(DATA_DIR, 'electron'));
try { app.setPath('logs', LOG_DIR); } catch { /* ignore */ }

// A crash/kill leaves runtime.json behind; never let a stale one pass for a live instance.
try { fs.rmSync(path.join(DATA_DIR, 'runtime.json'), { force: true }); } catch { /* ignore */ }

const NONCE = crypto.randomBytes(16).toString('hex');
const redact = makeRedactor([NONCE]);
const log = createLogger(LOG_DIR, redact);
const appVersion = (() => { try { return require(path.join(BACKEND_DIR, 'package.json')).version; } catch { return app.getVersion(); } })();

// ---- state -----------------------------------------------------------------
let win = null;
let gateway = null;
let gatewayPort = null;
let backend = null;
let frontend = null;
const ports = {};
let state = 'starting';
let lastError = null;
let shuttingDown = false;
let booting = false;
const restarts = [];

const origin = () => `http://127.0.0.1:${gatewayPort}`;
const send = (s) => { if (win && !win.isDestroyed() && win.webContents.getURL().startsWith('file:')) win.webContents.send('shell:state', s); };
const progress = (message) => { log.info(message); send({ kind: 'progress', message }); };

function childEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS') delete env[k];
  return env;
}

// ---- window ------------------------------------------------------------------
function createWindow() {
  const saved = settings.load(DATA_DIR).window;
  const bounds = settings.visibleBounds(saved && saved.bounds, screen.getAllDisplays());
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1000, minHeight: 640,
    ...(bounds || {}),
    show: false, title: APP_NAME, backgroundColor: '#f4f8f5', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (saved && saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    try {
      settings.save(DATA_DIR, { window: { bounds: win.isMaximized() ? (settings.load(DATA_DIR).window || {}).bounds : win.getBounds(), maximized: win.isMaximized() } });
    } catch { /* ignore */ }
  });
  win.on('closed', () => { win = null; });
  win.webContents.on('render-process-gone', (_e, d) => {
    log.error(`renderer gone: ${d.reason}`);
    if (!shuttingDown && state === 'ready' && win) win.loadURL(origin());
  });
  const lock = (url) => {
    let u; try { u = new URL(url); } catch { return false; }
    return u.origin === origin();
  };
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || lock(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (lock(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 1000, height: 800 } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return win.loadFile(SPLASH);
}

function pageReady() {
  return new Promise((resolve) => ipcMain.once('shell:page-ready', () => resolve()));
}

async function showError({ title, message, detail, actions, code }) {
  state = 'error';
  lastError = { code, message: `${title}: ${message}` };
  log.error(`${code || 'ERROR'} ${title}: ${message}`);
  if (!win) return;
  if (!win.webContents.getURL().startsWith('file:')) { const ready = pageReady(); await win.loadFile(SPLASH); await ready; }
  send({ kind: 'error', title, message, detail: detail || `Data folder: ${DATA_DIR}`, actions: actions || ['retry', 'report', 'logs', 'exit'] });
}

// ---- children ----------------------------------------------------------------
async function stopChildren() {
  const list = [backend, frontend].filter(Boolean);
  backend = null; frontend = null;
  await Promise.all(list.map((c) => c.stop(5000)));
}

function launchBackend(port) {
  const sink = log.childSink('backend.log');
  return startChild({
    name: 'backend', command: NODE_EXE, cwd: BACKEND_DIR, sink,
    args: ['--require', WATCHDOG, ENTRY],
    env: childEnv({
      NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1',
      NODEDR_DATA_DIR: DATA_DIR, DATABASE_URL: `file:${DB_FILE.split(path.sep).join('/')}`,
      FRONTEND_ORIGIN: origin(), COOKIE_SECURE: 'false', NODEDR_EDITION: 'store', NODEDR_INSTANCE_NONCE: NONCE,
    }),
    onExit: (info) => onChildExit('backend', info),
  });
}
function launchFrontend(port, backendPort) {
  const sink = log.childSink('frontend.log');
  return startChild({
    name: 'frontend', command: NODE_EXE, cwd: FRONTEND_DIR, sink,
    args: ['--require', WATCHDOG, 'server.js'],
    env: childEnv({ NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1', BACKEND_URL: `http://127.0.0.1:${backendPort}` }),
    onExit: (info) => onChildExit('frontend', info),
  });
}

async function onChildExit(name, info) {
  log.warn(`${name} exited ${JSON.stringify(info)}`);
  if (shuttingDown || booting || state !== 'ready') return;
  // A running child died: restart it on the same port a few times, then give up loudly.
  const now = Date.now();
  restarts.push(now);
  while (restarts.length && now - restarts[0] > 60000) restarts.shift();
  if (restarts.length > 3) {
    await stopChildren();
    return showError({ title: 'NodeDR POS stopped unexpectedly', message: `The ${name} service keeps stopping.`, code: 'CHILD_CRASH_LOOP' });
  }
  log.info(`restarting ${name}`);
  if (name === 'backend') backend = launchBackend(ports.backend);
  else frontend = launchFrontend(ports.frontend, ports.backend);
}

const httpGet = async (url, ms = 2000) => fetch(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' });

async function startServices() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    ports.backend = await freeLoopbackPort();
    ports.frontend = await freeLoopbackPort();
    progress('Starting NodeDR POS…');
    backend = launchBackend(ports.backend);
    frontend = launchFrontend(ports.frontend, ports.backend);
    const b = await waitUntil(async () => {
      const r = await httpGet(`http://127.0.0.1:${ports.backend}/api/health`);
      const j = r.ok ? await r.json() : null;
      return j && j.status === 'ok' && j.instance === NONCE; // our process, not an unrelated service on that port
    }, { timeoutMs: 60000, isAlive: () => !backend.exited });
    const f = b.ok && (await waitUntil(async () => (await httpGet(`http://127.0.0.1:${ports.frontend}/login`, 4000)).status < 500, { timeoutMs: 90000, isAlive: () => !frontend.exited }));
    if (b.ok && f.ok) {
      const g = await httpGet(`${origin()}/api/health`);
      const j = await g.json();
      if (j.instance === NONCE) return { ok: true };
    }
    const reason = !b.ok ? `backend ${b.reason}` : `frontend ${f.reason}`;
    const exitedEarly = (!b.ok && b.reason === 'exited') || (b.ok && !f.ok && f.reason === 'exited');
    log.warn(`start attempt ${attempt} failed: ${reason}`);
    await stopChildren();
    if (!exitedEarly) return { ok: false, message: `The local service did not become ready (${reason}).` };
    // exited early: most likely the port was taken between probing and binding — pick new ports and retry
  }
  return { ok: false, message: 'The local service could not start (ports were unavailable).' };
}

// ---- database ----------------------------------------------------------------
const tool = (args, onProgress) => runDbTool({
  nodeExe: NODE_EXE, toolPath: DBTOOL, backendDir: BACKEND_DIR, args: [...args, '--data', DATA_DIR], onProgress, log: (l) => log.to('migration.log', l),
});

const describe = (s) => `${s.shopName ? `“${s.shopName}” — ` : ''}${s.products} products, ${s.invoices} invoices, ${s.customers} customers, ${s.users} users`;

function explainDbError(r) {
  const map = {
    CORRUPT: { title: 'The database needs attention', actions: ['restore', 'report', 'logs', 'data', 'exit'] },
    NEWER_DB: { title: 'This data is from a newer version', actions: ['report', 'exit'] },
    LOCKED: { title: 'The database is in use', actions: ['retry', 'report', 'exit'] },
    MIGRATION_FAILED: { title: 'The update could not be applied', actions: ['retry', 'report', 'logs', 'data', 'exit'] },
    RECOVERY_FAILED: { title: 'Recovery needs support', actions: ['report', 'logs', 'data', 'exit'] },
  };
  return { ...(map[r.code] || { title: 'The database could not be prepared', actions: ['retry', 'report', 'logs', 'data', 'exit'] }), message: r.message, code: r.code };
}

async function offerLegacyImport() {
  if (fs.existsSync(DB_FILE) || settings.load(DATA_DIR).legacyDeclined) return;
  const found = findLegacyStore();
  if (!found) return;
  const insp = await tool(['inspect', '--source', found.path]);
  if (!insp.ok) { log.warn(`legacy data found but not importable: ${insp.code}`); return; }
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', title: APP_NAME, noLink: true, defaultId: 0, cancelId: 1,
    message: 'Found your data from an earlier version of NodeDR POS.',
    detail: `${describe(insp.summary)}\n\nImport it now? The original files are not changed or deleted.`,
    buttons: ['Import my data', 'Start with a new database'],
  });
  if (response === 0) {
    progress('Importing your data…');
    const r = await tool(['import', '--source', found.path]);
    if (!r.ok) await dialog.showMessageBox(win, { type: 'error', title: APP_NAME, message: 'The data could not be imported.', detail: `${r.message}\n\nYour original data was not changed. Starting with a new database; you can retry from File → Import or restore data.` });
  } else {
    settings.save(DATA_DIR, { legacyDeclined: true });
  }
}

// ---- boot ----------------------------------------------------------------------
async function boot() {
  if (booting) return;
  booting = true; shuttingDown = false; state = 'starting'; lastError = null;
  try {
    if (!win) return;
    if (!win.webContents.getURL().startsWith('file:')) { const ready = pageReady(); await win.loadFile(SPLASH); await ready; }
    progress('Starting NodeDR POS…');

    if (!gateway) {
      gateway = createGateway({ getBackendPort: () => ports.backend, getFrontendPort: () => ports.frontend, nonce: NONCE });
      gatewayPort = await gateway.listen(PREFERRED_PORTS);
      if (!(await pingNonce(gatewayPort, NONCE))) throw Object.assign(new Error('local server identity check failed'), { code: 'GATEWAY_IDENTITY' });
    }
    writeRuntime('starting');

    await offerLegacyImport();

    progress('Checking your data…');
    const prep = await tool(['prepare'], (p) => progress(p.message));
    if (!prep.ok) return await showError(explainDbError(prep));
    if (prep.state === 'migrated') log.info(`database upgraded; pre-migration backup: ${prep.backup}`);

    const started = await startServices();
    if (!started.ok) return await showError({ title: 'NodeDR POS could not start', message: started.message, code: 'START_FAILED' });

    state = 'ready';
    await win.loadURL(origin());
    writeRuntime('ready');
    log.info(`READY ${origin()} (backend ${ports.backend}, frontend ${ports.frontend})`);
  } catch (err) {
    await stopChildren();
    await showError({ title: 'NodeDR POS could not start', message: String(err.message || err), code: err.code || 'BOOT_FAILED' });
  } finally {
    booting = false;
  }
}

function writeRuntime(s) {
  try {
    fs.writeFileSync(path.join(DATA_DIR, 'runtime.json'), JSON.stringify({ pid: process.pid, state: s, gatewayPort, backendPort: ports.backend, frontendPort: ports.frontend, startedAt: new Date().toISOString() }));
  } catch { /* ignore */ }
}

// ---- user actions ----------------------------------------------------------------
const report = () => buildReport({
  appVersion, electronVersion: process.versions.electron, dataDir: DATA_DIR, dataKind: where.kind, packageFamily: where.packageFamily,
  logDir: LOG_DIR, ports: { gateway: gatewayPort, ...ports }, state, error: lastError, redact,
});

async function doBackup() {
  const stampDate = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Back up NodeDR POS data', defaultPath: path.join(app.getPath('documents'), `NodeDR POS backup ${stampDate}.zip`),
    filters: [{ name: 'NodeDR POS backup', extensions: ['zip'] }],
  });
  if (canceled || !filePath) return;
  const r = await tool(['backup', '--dest', filePath]);
  if (r.ok) {
    shell.showItemInFolder(filePath);
    await dialog.showMessageBox(win, { type: 'info', title: APP_NAME, message: 'Backup saved.', detail: `${filePath}\n\nKeep a copy somewhere safe. Uninstalling NodeDR POS from Windows deletes the data stored on this PC, so back up first.` });
  } else {
    await dialog.showMessageBox(win, { type: 'error', title: APP_NAME, message: 'The backup could not be saved.', detail: r.message });
  }
}

async function runImport(source, { replace }) {
  const insp = await tool(['inspect', '--source', source]);
  if (!insp.ok) return dialog.showMessageBox(win, { type: 'error', title: APP_NAME, message: 'That data cannot be used.', detail: insp.message });
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', title: APP_NAME, noLink: true, defaultId: 1, cancelId: 1,
    message: replace ? 'Replace the data in NodeDR POS with this?' : 'Import this data?',
    detail: `${describe(insp.summary)}\n\n${replace ? `This replaces everything currently in NodeDR POS. A safety copy of the current data is kept in:\n${path.join(DATA_DIR, 'backups')}\n\n` : ''}The source files are not changed.`,
    buttons: [replace ? 'Replace current data' : 'Import', 'Cancel'],
  });
  if (response !== 0) return;
  state = 'starting';
  const ready = pageReady(); await win.loadFile(SPLASH); await ready;
  progress('Stopping services…');
  await stopChildren();
  progress('Importing your data…');
  const r = await tool(['import', '--source', source, ...(replace ? ['--replace'] : [])]);
  if (!r.ok) {
    await dialog.showMessageBox(win, { type: 'error', title: APP_NAME, message: 'The import failed. Your previous data was kept.', detail: r.message });
  }
  await boot();
}

async function chooseAndImport() {
  const replace = fs.existsSync(DB_FILE);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', title: APP_NAME, noLink: true, defaultId: 0, cancelId: 3,
    message: 'Import or restore data',
    detail: 'Choose where the data comes from. Your current data is backed up before anything is replaced.',
    buttons: ['A NodeDR POS backup (.zip) or database file…', 'Find my Docker installation', 'A data folder…', 'Cancel'],
  });
  if (response === 3) return;
  if (response === 0) {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a backup or database', properties: ['openFile'], filters: [{ name: 'Backup or database', extensions: ['zip', 'db', 'sqlite'] }, { name: 'All files', extensions: ['*'] }] });
    if (!r.canceled && r.filePaths[0]) await runImport(r.filePaths[0], { replace });
  } else if (response === 1) {
    progress('Looking for Docker data…');
    const hits = await findDockerVolumes();
    if (win && state === 'ready') win.loadURL(origin()).catch(() => {}); // restore the app view if we only showed progress
    if (!hits.length) {
      return dialog.showMessageBox(win, { type: 'info', title: APP_NAME, message: 'No Docker data found automatically.', detail: 'Docker Desktop may be stopped, or it stores data elsewhere. Start Docker Desktop and try again, or copy the data out with the steps in the guide (docs/WINDOWS-STORE.md), then choose “A data folder…”.' });
    }
    await runImport(hits[0].path, { replace });
  } else {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the folder that contains pos.db', properties: ['openDirectory'] });
    if (!r.canceled && r.filePaths[0]) await runImport(r.filePaths[0], { replace });
  }
}

async function showDiagnostics() {
  const dbSize = (() => { try { return `${(fs.statSync(DB_FILE).size / 1048576).toFixed(2)} MB`; } catch { return 'not created yet'; } })();
  const { response } = await dialog.showMessageBox(win, {
    type: 'info', title: `${APP_NAME} diagnostics`, noLink: true, defaultId: 3, cancelId: 3,
    message: `${APP_NAME} ${appVersion} — Microsoft Store edition`,
    detail: [`State: ${state}`, `Data folder: ${DATA_DIR}`, `Database: ${dbSize}`, `Logs folder: ${LOG_DIR}`, `Local address: ${gatewayPort ? origin() : 'not running'} (this PC only)`,
      '', 'Uninstalling the app from Windows deletes the data above. Use File → Back up data first.'].join('\n'),
    buttons: ['Copy support report', 'Open data folder', 'Open logs folder', 'Close'],
  });
  if (response === 0) clipboard.writeText(report());
  else if (response === 1) shell.openPath(DATA_DIR);
  else if (response === 2) shell.openPath(LOG_DIR);
}

ipcMain.handle('shell:action', async (event, name) => {
  if (!event.senderFrame || !String(event.senderFrame.url).startsWith('file:')) return null; // only our own pages
  switch (name) {
    case 'retry': await stopChildren(); boot(); return true;
    case 'report': clipboard.writeText(report()); return { copied: true };
    case 'logs': shell.openPath(LOG_DIR); return true;
    case 'data': shell.openPath(DATA_DIR); return true;
    case 'restore': chooseAndImport(); return true;
    case 'exit': app.quit(); return true;
    default: return null;
  }
});

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '&File', submenu: [
      { label: 'Back up data…', click: () => doBackup() },
      { label: 'Import or restore data…', click: () => chooseAndImport() },
      { type: 'separator' },
      { label: 'Open data folder', click: () => shell.openPath(DATA_DIR) },
      { label: 'Open logs folder', click: () => shell.openPath(LOG_DIR) },
      { type: 'separator' },
      { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() },
    ] },
    { label: '&View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => { if (win && state === 'ready') win.loadURL(origin()); } },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { label: '&Help', submenu: [
      { label: 'Diagnostics…', click: () => showDiagnostics() },
      { label: 'Copy support report', click: () => clipboard.writeText(report()) },
      { type: 'separator' },
      { label: 'NodeDR POS website', click: () => shell.openExternal(SITE) },
    ] },
  ]));
}

// ---- app lifecycle ------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(async () => {
    log.info(`start ${APP_NAME} ${appVersion} electron ${process.versions.electron} data=${DATA_DIR} (${where.kind})`);
    buildMenu();
    // Only the camera, and only for our own page (camera barcode scanning).
    const allow = (permission, requestingOrigin) => permission === 'media' && !!gatewayPort && requestingOrigin === origin();
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => cb(allow(permission, details && details.requestingUrl ? new URL(details.requestingUrl).origin : '')));
    session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allow(permission, (requestingOrigin || '').replace(/\/$/, '')));
    await createWindow();
    boot();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (e) => {
    if (shuttingDown) return;
    shuttingDown = true;
    e.preventDefault();
    log.info('shutting down');
    (async () => {
      try { if (gateway) await Promise.race([gateway.close(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* ignore */ }
      await stopChildren();
      try { fs.rmSync(path.join(DATA_DIR, 'runtime.json'), { force: true }); } catch { /* ignore */ }
      log.info('stopped');
      app.exit(0);
    })();
  });
}
