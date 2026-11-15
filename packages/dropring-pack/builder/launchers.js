'use strict';
// Locating the prebuilt launcher binary for a target.
//
// M0 sources, in order:
//   1. --launcher-dir / DROPRING_PACK_LAUNCHER_DIR, laid out as <dir>/<target>/dropring-pack-<kind>[.exe]
//      (the layout of the CI launcher artefacts)
//   2. a local cargo build: launcher/target/<triple>/release/... or, for the host, launcher/target/release/...
// From M1 the builder also downloads pinned release assets (launchers.json with SHA-256).

const fs = require('fs');
const path = require('path');
const { hostTargetId } = require('./targets');
const { sha256File } = require('./util');

const LAUNCHER_ROOT = path.join(__dirname, '..', 'launcher');

/**
 * @param {import('./targets').Target} target
 * @param {'console'|'windowed'} kind
 * @param {{launcherDir?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {Promise<{path: string, sha256: string, version: string, kind: string, source: string}>}
 */
async function findLauncher(target, kind, { launcherDir, env = process.env } = {}) {
  const file = `dropring-pack-${kind}${target.os === 'windows' ? '.exe' : ''}`;
  const dirs = [];
  const explicit = launcherDir || env.DROPRING_PACK_LAUNCHER_DIR;
  if (explicit) dirs.push(path.join(path.resolve(explicit), target.id));
  dirs.push(path.join(LAUNCHER_ROOT, 'target', target.triple, 'release'));
  if (hostTargetId() === target.id) dirs.push(path.join(LAUNCHER_ROOT, 'target', 'release'));
  for (const dir of dirs) {
    const candidate = path.join(dir, file);
    if (fs.existsSync(candidate)) {
      return { path: candidate, sha256: await sha256File(candidate), version: launcherVersion(dir), kind, source: dir };
    }
  }
  throw new Error(
    `no ${kind} launcher for ${target.id}. Build it with "cargo build --release --target ${target.triple}" in ` +
    `${LAUNCHER_ROOT}, or pass --launcher-dir <dir> containing ${target.id}/${file}. Looked in:\n  ${dirs.join('\n  ')}`,
  );
}

/** Version from a launcher.json written next to CI artefacts, else from the crate manifest. */
function launcherVersion(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'launcher.json'), 'utf8')).version;
  } catch {
    const toml = fs.readFileSync(path.join(LAUNCHER_ROOT, 'Cargo.toml'), 'utf8');
    return (/^version\s*=\s*"([^"]+)"/m.exec(toml) || [])[1] || 'unknown';
  }
}

module.exports = { findLauncher, launcherVersion, LAUNCHER_ROOT };
