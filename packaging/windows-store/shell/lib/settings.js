const fs = require('fs');
const path = require('path');

function load(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'shell-settings.json'), 'utf8')); } catch { return {}; }
}
function save(dataDir, patch) {
  const next = { ...load(dataDir), ...patch };
  try {
    const f = path.join(dataDir, 'shell-settings.json');
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(next, null, 2));
    fs.renameSync(`${f}.tmp`, f);
  } catch { /* never fatal */ }
  return next;
}
/** Restore saved bounds only if they still land on a connected display. */
function visibleBounds(saved, displays) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.width) || saved.width < 400 || saved.height < 300) return null;
  const ok = displays.some((d) => {
    const w = d.workArea || d.bounds;
    return saved.x < w.x + w.width - 80 && saved.x + saved.width > w.x + 80 && saved.y >= w.y - 10 && saved.y < w.y + w.height - 80;
  });
  return ok ? saved : null;
}
module.exports = { load, save, visibleBounds };
