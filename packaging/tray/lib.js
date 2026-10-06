// Pure helpers for the tray app — kept free of any GUI dependency so they can
// be unit-tested on any machine.
const { execFile } = require('child_process');
const http = require('http');

const APP_URL = process.env.NODEDR_URL || 'http://localhost:1994';

// Wrap a PNG in an ICO container (ICO entries may hold PNG data since
// Windows Vista) — systray2 needs an .ico on Windows, a PNG elsewhere, and
// this lets one PNG serve both with no image tooling at build time.
function pngToIco(png) {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  head[6] = w >= 256 ? 0 : w;
  head[7] = h >= 256 ? 0 : h;
  head.writeUInt16LE(1, 10); // planes
  head.writeUInt16LE(32, 12); // bpp
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18); // data offset
  return Buffer.concat([head, png]);
}

// GET /api/health -> true when the backend answers { status: "ok" }.
function checkHealth(url = APP_URL, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 && JSON.parse(body).status === 'ok');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// Per-OS "restart the POS service" command. Each avoids a console flash and
// asks for elevation only where the OS requires it.
function restartCommand(platform = process.platform, uid = process.getuid?.()) {
  if (platform === 'win32') {
    // Windows services need admin: elevate a single PowerShell restart.
    return ['powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', "Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Restart-Service NodeDRPOSBackend,NodeDRPOSFrontend'"]];
  }
  if (platform === 'darwin') {
    // Per-user LaunchAgent (no admin): kickstart -k restarts it.
    return ['launchctl', ['kickstart', '-k', `gui/${uid}/com.nodedr.pos`]];
  }
  // Linux: the .deb installs a systemd unit; pkexec shows the desktop's own auth dialog.
  return ['pkexec', ['systemctl', 'restart', 'nodedr-pos.service']];
}

function restart(platform) {
  const [cmd, args] = restartCommand(platform);
  return new Promise((resolve) => execFile(cmd, args, (err) => resolve(!err)));
}

function openUrl(url = APP_URL, platform = process.platform) {
  const [cmd, args] = platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {});
}

module.exports = { APP_URL, pngToIco, checkHealth, restartCommand, restart, openUrl };
