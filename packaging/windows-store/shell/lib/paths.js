// Where the Store edition keeps its mutable data.
//
// Inside the MSIX, everything under C:\Program Files\WindowsApps is read-only,
// and AppData writes by a packaged desktop app are silently *virtualised* into
// the package's private store. The one location Windows documents as the app's
// real, per-user, non-virtualised data folder is
//   %LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalState
// (what Windows.Storage.ApplicationData.LocalFolder reports). It survives app
// updates and is deleted when the user uninstalls the app.
const path = require('path');

/**
 * "C:\Program Files\WindowsApps\Nodedr.POS_1.6.2.0_x64__8wekyb3d8bbwe\NodeDRPOS.exe"
 *  -> "Nodedr.POS_8wekyb3d8bbwe"  (PackageFamilyName = Name + "_" + PublisherId)
 */
function packageFamilyFromPath(execPath) {
  const m = /[\\/]WindowsApps[\\/]([^\\/]+)[\\/]/i.exec(String(execPath || ''));
  if (!m) return null;
  // Folder name: <Name>_<Version>_<Arch>_<ResourceId>_<PublisherId>
  const parts = m[1].split('_');
  return parts.length >= 5 && parts[0] && parts[parts.length - 1] ? `${parts[0]}_${parts[parts.length - 1]}` : null;
}

function resolveDataDir({ env = process.env, execPath = process.execPath, platform = process.platform } = {}) {
  if (env.NODEDR_DATA_DIR) return { dir: path.resolve(env.NODEDR_DATA_DIR), kind: 'override', packageFamily: null };
  const w = path.win32;
  const local = env.LOCALAPPDATA || (env.USERPROFILE && w.join(env.USERPROFILE, 'AppData', 'Local')) || null;
  if (platform !== 'win32' || !local) {
    return { dir: path.join(env.HOME || '.', '.nodedr-pos'), kind: 'dev', packageFamily: null };
  }
  const pfn = packageFamilyFromPath(execPath);
  if (pfn) return { dir: w.join(local, 'Packages', pfn, 'LocalState', 'NodeDRPOS'), kind: 'package', packageFamily: pfn };
  return { dir: w.join(local, 'NodeDRPOS'), kind: 'user', packageFamily: null };
}

/** Folders an earlier Store version (WebView2 launcher) used. Detection only — never modified. */
function legacyStoreDataDir(env = process.env) {
  return env.ProgramData ? path.win32.join(env.ProgramData, 'NodeDRPOS') : null;
}

module.exports = { packageFamilyFromPath, resolveDataDir, legacyStoreDataDir };
