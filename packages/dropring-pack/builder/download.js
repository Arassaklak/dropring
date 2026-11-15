'use strict';
// Verified downloads. Every file we fetch has a pinned SHA-256; a mismatch is fatal.
// Files are written to a temporary name in the destination folder and renamed only
// after the hash matched, so the cache never contains half-written or unverified files.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { sha256File } = require('./util');
const { isOffline } = require('./cache');

class HashMismatchError extends Error {
  constructor(url, expected, actual) {
    super(`SHA-256 mismatch for ${url}: expected ${expected}, got ${actual}. The download was discarded.`);
    this.name = 'HashMismatchError';
    this.code = 'HASH_MISMATCH';
  }
}

function checkUrl(url) {
  const u = new URL(url);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new Error(`refusing to download over ${u.protocol} (HTTPS required): ${url}`);
  }
}

/**
 * Downloads `url` to `dest` unless `dest` already exists with the expected hash.
 * @param {{url: string, dest: string, sha256: string, size?: number, signal?: AbortSignal,
 *          onProgress?: (received: number, total: number|null) => void, retries?: number,
 *          env?: NodeJS.ProcessEnv}} opts
 * @returns {Promise<{path: string, cached: boolean}>}
 */
async function download({ url, dest, sha256, size, signal, onProgress, retries = 2, env = process.env }) {
  if (!/^[0-9a-f]{64}$/.test(sha256 || '')) throw new Error(`no valid pinned SHA-256 for ${url}`);
  if (fs.existsSync(dest)) {
    if ((await sha256File(dest)) === sha256) return { path: dest, cached: true };
    await fs.promises.rm(dest, { force: true }); // tampered or corrupt cache entry
  }
  if (isOffline(env)) throw new Error(`offline mode (DROPRING_PACK_OFFLINE=1) and ${path.basename(dest)} is not in the cache`);
  checkUrl(url);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal && signal.aborted) throw signal.reason || new Error('aborted');
    const tmp = `${dest}.part-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      const res = await fetch(url, { redirect: 'follow', signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      checkUrl(res.url || url); // the final URL after redirects must be HTTPS too
      const total = Number(res.headers.get('content-length')) || size || null;
      const hash = crypto.createHash('sha256');
      let received = 0;
      const meter = new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          received += chunk.length;
          if (onProgress) onProgress(received, total);
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(tmp, { mode: 0o644 }), { signal });
      const actual = hash.digest('hex');
      if (actual !== sha256) throw new HashMismatchError(url, sha256, actual);
      await fs.promises.rename(tmp, dest);
      return { path: dest, cached: false };
    } catch (err) {
      await fs.promises.rm(tmp, { force: true });
      if (err && err.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

module.exports = { download, HashMismatchError };
