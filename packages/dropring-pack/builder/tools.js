'use strict';
// Build tools the builder runs itself (ADR-0004): uv, pinned in runtime/tools.json with the
// SHA-256 of every host archive, downloaded once into the cache and verified like runtimes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TOOLS = require('../runtime/tools.json');
const { download } = require('./download');
const { cacheRoot } = require('./cache');
const { hostTriple } = require('./targets');

/**
 * Path of a verified uv executable for this computer.
 * @param {{env?: NodeJS.ProcessEnv, cacheDir?: string, signal?: AbortSignal}} [opts]
 */
async function ensureUv({ env = process.env, cacheDir = cacheRoot(env), signal } = {}) {
  if (env.DROPRING_PACK_UV) return env.DROPRING_PACK_UV; // explicit override (tests, air-gapped setups)
  const triple = hostTriple();
  const asset = triple && TOOLS.uv.assets[triple];
  if (!asset) throw new Error(`no pinned uv build for this computer (${process.platform}-${process.arch})`);
  const dir = path.join(cacheDir, 'tools', `uv-${TOOLS.uv.version}`, asset.sha256);
  const exe = path.join(dir, process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (fs.existsSync(exe)) return exe;
  const archive = path.join(cacheDir, 'downloads', asset.sha256, asset.file);
  const url = TOOLS.uv.urlTemplate.replace('{version}', TOOLS.uv.version).replace('{file}', asset.file);
  await download({ url, dest: archive, sha256: asset.sha256, size: asset.size, signal, env });
  const tmp = `${dir}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.promises.mkdir(tmp, { recursive: true });
  try {
    if (asset.file.endsWith('.zip')) {
      const { readZipEntry } = require('./zip');
      await fs.promises.writeFile(path.join(tmp, 'uv.exe'), await readZipEntry(archive, 'uv.exe'));
    } else {
      await require('tar').x({ file: archive, cwd: tmp, strict: true, preservePaths: false, filter: (p) => /(^|\/)uv$/.test(p) });
      const found = (await fs.promises.readdir(tmp, { recursive: true })).find((p) => path.basename(p) === 'uv');
      if (!found) throw new Error(`${asset.file} does not contain uv`);
      await fs.promises.rename(path.join(tmp, found), path.join(tmp, 'uv'));
      await fs.promises.chmod(path.join(tmp, 'uv'), 0o755);
    }
    await fs.promises.mkdir(path.dirname(dir), { recursive: true });
    try { await fs.promises.rename(tmp, dir); } catch (err) { if (!fs.existsSync(exe)) throw err; }
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
  return exe;
}

module.exports = { ensureUv, TOOLS };
