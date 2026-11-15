'use strict';
// Small filesystem helpers shared by the builder. Everything here is deterministic:
// directory listings are sorted and paths are reported with forward slashes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** SHA-256 of a file, streamed. */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Relative path with forward slashes. */
const toPosix = (p) => p.split(path.sep).join('/');

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Lists a tree depth-first in a stable order.
 * @param {string} root
 * @returns {Promise<{rel: string, abs: string, type: 'file'|'dir'|'symlink', stat: fs.Stats}[]>}
 */
async function walk(root) {
  const out = [];
  const visit = async (dir, relDir) => {
    const names = (await fs.promises.readdir(dir)).sort(byCodeUnit);
    for (const name of names) {
      const abs = path.join(dir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      const stat = await fs.promises.lstat(abs);
      const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : null;
      if (!type) continue; // sockets, fifos, devices are never copied
      out.push({ rel, abs, type, stat });
      if (type === 'dir') await visit(abs, rel);
    }
  };
  await visit(root, '');
  return out;
}

/** True if `child` is `parent` or inside it (both resolved). */
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Makes a string safe as a file or folder name on Windows and macOS. */
function sanitizeFileName(name) {
  const cleaned = String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120);
  if (!cleaned) return 'App';
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) ? `${cleaned}_` : cleaned;
}

/** Lower-case slug for identifiers (bundle ids, cache keys). */
const slug = (s) => String(s).normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/_/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'app';

/** Sets atime/mtime of every entry under root (symlinks themselves, not their targets). */
async function setTreeTimes(root, date) {
  const entries = await walk(root);
  // Children first, so updating a file does not touch its directory's mtime afterwards.
  for (const e of entries.reverse()) {
    if (e.type === 'symlink') await fs.promises.lutimes(e.abs, date, date).catch(() => {});
    else await fs.promises.utimes(e.abs, date, date);
  }
  await fs.promises.utimes(root, date, date);
}

/** Fixed timestamp for reproducible output: SOURCE_DATE_EPOCH or 2024-01-01T00:00:00Z. */
function reproducibleDate(env = process.env) {
  const epoch = Number.parseInt(env.SOURCE_DATE_EPOCH || '', 10);
  return new Date((Number.isFinite(epoch) && epoch > 0 ? epoch : 1704067200) * 1000);
}

/** Throws an AbortError if the signal was aborted. */
function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const err = new Error('build cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

module.exports = { sha256File, sha256, toPosix, walk, isInside, sanitizeFileName, slug, setTreeTimes, reproducibleDate, throwIfAborted };
