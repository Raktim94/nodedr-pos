#!/usr/bin/env node
// NodeDR POS tray / menu-bar icon:
//   • click "Open NodeDR POS" for the register
//   • a live status line (green running / red stopped, checked every 5 s)
//   • "Restart service"
// Works on Windows, Linux (needs an AppIndicator-capable desktop) and macOS.
const fs = require('fs');
const path = require('path');
const { APP_URL, pngToIco, checkHealth, restart, openUrl } = require('./lib');

let SysTray;
try {
  SysTray = require('systray2').default;
} catch (e) {
  console.error('systray2 is not installed — run `npm install` in the tray folder.', e.message);
  process.exit(1);
}

const png = fs.readFileSync(path.join(__dirname, 'icon.png'));
const icon = (process.platform === 'win32' ? pngToIco(png) : png).toString('base64');

const items = {
  open: { title: 'Open NodeDR POS', tooltip: 'Open the register in your browser', enabled: true },
  status: { title: '○ Checking…', tooltip: 'Service status', enabled: false },
  restart: { title: 'Restart service', tooltip: 'Restart the POS service', enabled: true },
  quit: { title: 'Quit tray icon', tooltip: 'Closes this icon (the POS keeps running)', enabled: true },
};

const tray = new SysTray({
  menu: {
    icon,
    isTemplateIcon: process.platform === 'darwin',
    title: '',
    tooltip: 'NodeDR POS',
    items: [items.open, items.status, SysTray.separator, items.restart, SysTray.separator, items.quit],
  },
  debug: false,
  copyDir: true,
});

let last = null;
async function refresh() {
  const up = await checkHealth(APP_URL);
  if (up === last) return;
  last = up;
  tray.sendAction({
    type: 'update-item',
    item: { ...items.status, title: up ? '● Running' : '○ Stopped — use Restart', tooltip: up ? 'POS is running' : 'POS is not responding' },
    seq_id: 1,
  });
}

// systray2 hands back the very item object we registered, so match by identity
// (a seq_id would also count the separators).
tray.onClick(async (action) => {
  if (action.item === items.open) openUrl(APP_URL);
  if (action.item === items.restart) {
    last = null;
    tray.sendAction({ type: 'update-item', item: { ...items.status, title: '… Restarting' }, seq_id: 1 });
    await restart();
    setTimeout(refresh, 4000);
  }
  if (action.item === items.quit) {
    tray.kill(false);
    process.exit(0);
  }
});

refresh();
setInterval(refresh, 5000).unref?.();
