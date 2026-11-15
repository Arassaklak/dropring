'use strict';
// Cache location for downloaded runtimes (and later wheels and launchers).
//   DROPRING_PACK_CACHE overrides; otherwise the OS cache directory.

const os = require('os');
const path = require('path');

function cacheRoot(env = process.env, platform = process.platform) {
  if (env.DROPRING_PACK_CACHE) return path.resolve(env.DROPRING_PACK_CACHE);
  const home = os.homedir();
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'DropRingPack', 'Cache');
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'DropRingPack');
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'dropring-pack');
}

const isOffline = (env = process.env) => env.DROPRING_PACK_OFFLINE === '1';

module.exports = { cacheRoot, isOffline };
