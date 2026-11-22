// Finds data from an earlier install that the user may want to carry over.
// Detection is strictly read-only: nothing found here is opened for writing,
// moved or deleted, and nothing is ever imported without an explicit choice.
const fs = require('fs');
const path = require('path');
const { legacyStoreDataDir } = require('./paths');

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Cheap, local-disk only: the folder the earlier Store (WebView2) version used. */
function findLegacyStore(env = process.env) {
  const dir = legacyStoreDataDir(env);
  if (dir && exists(path.win32.join(dir, 'pos.db'))) return { kind: 'legacy-store', label: 'an earlier NodeDR POS from the Microsoft Store', path: dir };
  return null;
}

// Docker Desktop keeps named volumes inside its WSL2 disk. Which UNC root
// exposes them depends on the Docker Desktop version, so probe the known ones.
const DOCKER_VOLUME = 'nodedr-pos_data';
const DOCKER_ROOTS = [
  '\\\\wsl.localhost\\docker-desktop\\mnt\\docker-desktop-disk\\data\\docker\\volumes',
  '\\\\wsl$\\docker-desktop\\mnt\\docker-desktop-disk\\data\\docker\\volumes',
  '\\\\wsl.localhost\\docker-desktop-data\\data\\docker\\volumes',
  '\\\\wsl$\\docker-desktop-data\\data\\docker\\volumes',
];

/** Probing a \\wsl$ path can start WSL, so this only runs when the user asks. Each probe has a time limit. */
async function findDockerVolumes({ timeoutMs = 4000 } = {}) {
  const probe = (root) => {
    const dir = path.win32.join(root, DOCKER_VOLUME, '_data');
    return Promise.race([
      new Promise((r) => fs.stat(path.win32.join(dir, 'pos.db'), (err, st) => r(!err && st.isFile() ? dir : null))),
      new Promise((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
  };
  const hits = (await Promise.all(DOCKER_ROOTS.map(probe))).filter(Boolean);
  return [...new Set(hits)].map((p) => ({ kind: 'docker', label: 'a Docker installation of NodeDR POS', path: p }));
}

module.exports = { findLegacyStore, findDockerVolumes, DOCKER_VOLUME };
