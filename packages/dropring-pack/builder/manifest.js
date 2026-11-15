'use strict';
// Build manifest (SBOM): every file of the app with size and SHA-256, plus provenance of the
// runtime and launcher. Deterministic: sorted, no timestamps, no absolute paths.

const path = require('path');
const { walk, sha256File } = require('./util');

/**
 * Hashes all files under `root`.
 * @param {string} root
 * @param {{skip?: (rel: string) => boolean}} [opts]
 * @returns {Promise<{path: string, size: number, sha256?: string, link?: string}[]>}
 */
async function hashTree(root, { skip = () => false } = {}) {
  const out = [];
  for (const e of await walk(root)) {
    if (e.type === 'dir' || skip(e.rel)) continue;
    if (e.type === 'symlink') {
      out.push({ path: e.rel, size: 0, link: require('fs').readlinkSync(e.abs).split(path.sep).join('/') });
      continue;
    }
    out.push({ path: e.rel, size: e.stat.size, sha256: await sha256File(e.abs) });
  }
  return out;
}

function summarize(files) {
  return { count: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };
}

module.exports = { hashTree, summarize };
