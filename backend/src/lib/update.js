// "Is a newer NodeDR POS published?" + "update me now".
//
// Latest version = `version` in backend/package.json on the master branch.
// Docker/CasaOS installs are then only told about it once the matching image
// tag actually exists on GHCR (CI publishes after the push, so the version
// can briefly be ahead of the image — updating in that window would be a no-op).
//
// Applying an update is delegated to the `updater` sidecar container
// (Watchtower in HTTP-API mode) because a container cannot safely replace
// itself, and giving this API the Docker socket would be far more privilege
// than a POS backend should hold. The sidecar is reachable only on the
// internal Docker network and only with UPDATER_TOKEN.
const pkg = require('../../package.json');

const REPO = process.env.UPDATE_REPO || 'Raktim94/nodedr-pos';
const BRANCH = process.env.UPDATE_BRANCH || 'master';
const IMAGE = process.env.UPDATE_IMAGE || `ghcr.io/${REPO.toLowerCase().split('/')[0]}/nodedr-pos-backend`;
const CACHE_MS = 10 * 60 * 1000;

let cache = null; // { at, latest, error }

function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// > 0 when a is newer than b, < 0 when older, 0 when equal/unparseable.
function compareVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function updaterConfigured() {
  return !!process.env.UPDATER_URL;
}

async function imageTagExists(version) {
  // Anonymous pull token, then a manifest HEAD. Any failure other than a clear
  // 404 is treated as "can't tell" and the caller trusts the version number.
  const repo = IMAGE.replace(/^ghcr\.io\//, '');
  const tokRes = await fetch(`https://ghcr.io/token?scope=repository:${repo}:pull`, { signal: AbortSignal.timeout(6000) });
  if (!tokRes.ok) return null;
  const { token } = await tokRes.json();
  const res = await fetch(`https://ghcr.io/v2/${repo}/manifests/${version}`, {
    method: 'HEAD',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
    },
    signal: AbortSignal.timeout(6000),
  });
  if (res.status === 404) return false;
  return res.ok ? true : null;
}

async function fetchLatest() {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/backend/package.json`, {
    signal: AbortSignal.timeout(8000),
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const latest = (await res.json()).version;
  if (!parse(latest)) throw new Error('could not read the latest version');
  if (updaterConfigured() && compareVersions(latest, pkg.version) > 0) {
    const published = await imageTagExists(latest).catch(() => null);
    if (published === false) return pkg.version; // announced but image not built yet
  }
  return latest;
}

async function getStatus({ force = false } = {}) {
  if (force || !cache || Date.now() - cache.at > CACHE_MS) {
    try {
      cache = { at: Date.now(), latest: await fetchLatest(), error: null };
    } catch (err) {
      // Offline shops are the norm for this app — never an error state, just
      // "couldn't check". Keep the previous answer if we had one.
      cache = { at: Date.now(), latest: cache?.latest ?? null, error: err.message };
    }
  }
  const { latest, error } = cache;
  return {
    current: pkg.version,
    latest,
    updateAvailable: !!latest && compareVersions(latest, pkg.version) > 0,
    canUpdate: updaterConfigured(),
    checkedAt: new Date(cache.at).toISOString(),
    checkError: error,
    releaseUrl: `https://github.com/${REPO}/releases`,
  };
}

let applying = false;

// Kicks the updater and returns once it has clearly accepted the request.
// The updater pulls new images and recreates this very container, so the
// HTTP call to it can never complete from our side — we only wait long
// enough to catch "unreachable" and "wrong token".
async function applyUpdate() {
  if (!updaterConfigured()) {
    const e = new Error('This install has no updater. Update the app the way you installed it.');
    e.status = 501;
    throw e;
  }
  if (applying) {
    const e = new Error('An update is already in progress');
    e.status = 409;
    throw e;
  }
  applying = true;
  setTimeout(() => { applying = false; }, 5 * 60 * 1000).unref();

  const url = `${process.env.UPDATER_URL.replace(/\/$/, '')}/v1/update`;
  const req = fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPDATER_TOKEN || ''}` },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  }).then(
    (r) => ({ status: r.status }),
    (err) => ({ error: err }),
  );
  const first = await Promise.race([req, new Promise((r) => setTimeout(() => r({ pending: true }), 3000))]);
  if (first.pending) return; // still pulling — expected

  applying = false;
  if (first.error) {
    const e = new Error('Could not reach the updater container. Is "nodedr-pos-updater" running?');
    e.status = 502;
    throw e;
  }
  if (first.status === 401 || first.status === 403) {
    const e = new Error('The updater rejected the request (UPDATER_TOKEN mismatch)');
    e.status = 502;
    throw e;
  }
  if (first.status >= 400) {
    const e = new Error(`The updater responded ${first.status}`);
    e.status = 502;
    throw e;
  }
}

module.exports = { getStatus, applyUpdate, compareVersions };
