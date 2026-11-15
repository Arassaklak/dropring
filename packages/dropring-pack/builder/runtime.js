'use strict';
// Python runtimes: pick the pinned python-build-standalone build for a target, download it
// into the cache (hash-verified) and extract it once into a content-addressed folder.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MANIFEST = require('../runtime/runtimes.json');
const { download } = require('./download');
const { cacheRoot } = require('./cache');

/**
 * @typedef {object} RuntimeSpec
 * @property {string} minor      '3.14'
 * @property {string} version    '3.14.10'
 * @property {string} release    python-build-standalone release tag, e.g. '20261110'
 * @property {string} triple
 * @property {string} sha256     of the archive
 * @property {string} url
 * @property {string} filename
 * @property {boolean} endOfLife
 */

function normalizePython(value) {
  const m = /^\s*3\.(\d+)(?:\.(\d+))?\s*$/.exec(String(value));
  if (!m) throw new Error(`invalid Python version "${value}" (expected e.g. 3.14)`);
  return { minor: `3.${m[1]}`, patch: m[2] };
}

/**
 * @param {string|undefined} python  '3.14', '3.14.10' or undefined for the default
 * @param {import('./targets').Target} target
 * @returns {RuntimeSpec}
 */
function resolveRuntime(python, target, env = process.env) {
  const { minor, patch } = normalizePython(python || MANIFEST.default);
  const entry = MANIFEST.runtimes[minor];
  if (!entry) throw new Error(`Python ${minor} is not available; choose one of ${Object.keys(MANIFEST.runtimes).join(', ')}`);
  if (patch !== undefined && `${minor}.${patch}` !== entry.version) {
    throw new Error(`Python ${minor}.${patch} is not pinned; this version of dropring-pack ships ${entry.version}`);
  }
  const sha256 = entry.assets[target.triple];
  if (!sha256) throw new Error(`Python ${minor} has no build for ${target.label} (${target.triple}); choose a newer Python version`);
  const filename = `cpython-${entry.version}+${entry.release}-${target.triple}-${MANIFEST.flavor}.tar.gz`;
  const mirror = env.DROPRING_PACK_RUNTIME_MIRROR;
  const url = mirror
    ? `${mirror.replace(/\/+$/, '')}/${entry.release}/${encodeURIComponent(filename)}`
    : MANIFEST.urlTemplate.replace(/\{(\w+)\}/g, (m, k) => ({ release: entry.release, version: entry.version, triple: target.triple, flavor: MANIFEST.flavor })[k] ?? m);
  return { minor, version: entry.version, release: entry.release, triple: target.triple, sha256, url, filename, endOfLife: !!entry.endOfLife };
}

/** Lists pinned runtimes (for `dropring-pack runtimes list`). */
function listRuntimes() {
  return Object.entries(MANIFEST.runtimes).map(([minor, e]) => ({ minor, version: e.version, release: e.release, endOfLife: !!e.endOfLife, triples: Object.keys(e.assets), default: minor === MANIFEST.default }));
}

/**
 * Makes sure the runtime archive is downloaded and extracted.
 * @param {RuntimeSpec} spec
 * @returns {Promise<{root: string, archive: string, cached: boolean}>} root = extracted `python/` folder
 */
async function ensureRuntime(spec, { env = process.env, cacheDir = cacheRoot(env), signal, onProgress } = {}) {
  const archive = path.join(cacheDir, 'downloads', spec.sha256, spec.filename);
  const fetched = await download({ url: spec.url, dest: archive, sha256: spec.sha256, signal, onProgress, env });
  const dir = path.join(cacheDir, 'runtimes', spec.sha256);
  const marker = path.join(dir, '.complete');
  if (fs.existsSync(marker)) return { root: path.join(dir, 'python'), archive, cached: fetched.cached };

  await fs.promises.rm(dir, { recursive: true, force: true }); // leftover of an interrupted extraction
  const tmp = `${dir}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.promises.mkdir(tmp, { recursive: true });
  try {
    await require('tar').x({
      file: archive,
      cwd: tmp,
      strict: true,
      preservePaths: false, // strips leading "/" and refuses ".." entries
      preserveOwner: false,
      filter: (p) => p === 'python' || p.startsWith('python/'),
    });
    if (!fs.existsSync(path.join(tmp, 'python'))) throw new Error(`${spec.filename} does not contain a python/ folder`);
    await fs.promises.writeFile(path.join(tmp, '.complete'), JSON.stringify({ version: spec.version, release: spec.release, triple: spec.triple, sha256: spec.sha256 }) + '\n');
    try {
      await fs.promises.rename(tmp, dir);
    } catch (err) {
      if (!fs.existsSync(marker)) throw err; // another build extracted it first: use theirs
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  } catch (err) {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    throw err;
  }
  return { root: path.join(dir, 'python'), archive, cached: false };
}

/** File names inside the runtime that the launcher config refers to. */
function runtimeLayout(spec, os) {
  const [, minor] = spec.minor.split('.');
  if (os === 'windows') return { lib: `python3${minor}.dll`, pth: `python3${minor}._pth` };
  return { lib: `lib/libpython3.${minor}.dylib`, pth: null };
}

module.exports = { MANIFEST, resolveRuntime, ensureRuntime, listRuntimes, runtimeLayout, normalizePython };
