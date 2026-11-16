'use strict';
// Build tools the builder runs itself, pinned in runtime/tools.json with the SHA-256 of every
// host archive, downloaded once into the cache and verified like runtimes:
//   uv         dependency resolution and installation (ADR-0004)
//   rcodesign  ad-hoc signing of macOS apps on Linux/Windows hosts (ADR-0006)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TOOLS = require('../runtime/tools.json');
const { download } = require('./download');
const { cacheRoot } = require('./cache');
const { hostTriple } = require('./targets');

/**
 * Path of a verified tool executable for this computer.
 * @param {'uv'|'rcodesign'} name
 * @param {{env?: NodeJS.ProcessEnv, cacheDir?: string, signal?: AbortSignal}} [opts]
 */
async function ensureTool(name, { env = process.env, cacheDir = cacheRoot(env), signal } = {}) {
  const override = env[`DROPRING_PACK_${name.toUpperCase()}`]; // explicit path (tests, air-gapped setups)
  if (override) return override;
  const tool = TOOLS[name];
  const triple = hostTriple();
  const asset = tool && triple && tool.assets[triple];
  if (!asset) throw new Error(`no pinned ${name} build for this computer (${process.platform}-${process.arch})`);
  const exeName = process.platform === 'win32' ? `${name}.exe` : name;
  const dir = path.join(cacheDir, 'tools', `${name}-${tool.version}`, asset.sha256);
  const exe = path.join(dir, exeName);
  if (fs.existsSync(exe)) return exe;
  const archive = path.join(cacheDir, 'downloads', asset.sha256, asset.file);
  const url = tool.urlTemplate.replace('{version}', tool.version).replace('{file}', asset.file);
  await download({ url, dest: archive, sha256: asset.sha256, size: asset.size, signal, env });
  const tmp = `${dir}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.promises.mkdir(tmp, { recursive: true });
  try {
    if (asset.file.endsWith('.zip')) {
      const { readZipEntry } = require('./zip');
      await fs.promises.writeFile(path.join(tmp, exeName), await readZipEntry(archive, exeName));
    } else {
      const re = new RegExp(`(^|/)${name}$`);
      await require('tar').x({ file: archive, cwd: tmp, strict: true, preservePaths: false, filter: (p) => re.test(p) });
      const found = (await fs.promises.readdir(tmp, { recursive: true })).find((p) => path.basename(p) === name);
      if (!found) throw new Error(`${asset.file} does not contain ${name}`);
      await fs.promises.rename(path.join(tmp, found), path.join(tmp, exeName));
    }
    await fs.promises.chmod(path.join(tmp, exeName), 0o755);
    await fs.promises.mkdir(path.dirname(dir), { recursive: true });
    try { await fs.promises.rename(tmp, dir); } catch (err) { if (!fs.existsSync(exe)) throw err; }
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
  return exe;
}

const ensureUv = (opts) => ensureTool('uv', opts);

module.exports = { ensureTool, ensureUv, TOOLS };
