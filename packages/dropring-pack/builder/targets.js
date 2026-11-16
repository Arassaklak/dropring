'use strict';
// Build targets. A target names an OS + CPU combination we can produce an app for.

/**
 * @typedef {object} Target
 * @property {string} id        e.g. 'win-x64'
 * @property {'windows'|'macos'} os
 * @property {'x64'|'arm64'} arch
 * @property {string} triple    Rust / python-build-standalone target triple
 * @property {string} label     human-readable name
 */

/** @type {Readonly<Record<string, Target>>} */
const TARGETS = Object.freeze({
  'win-x64': { id: 'win-x64', os: 'windows', arch: 'x64', triple: 'x86_64-pc-windows-msvc', label: 'Windows x64' },
  'win-arm64': { id: 'win-arm64', os: 'windows', arch: 'arm64', triple: 'aarch64-pc-windows-msvc', label: 'Windows ARM64' },
  'mac-arm64': { id: 'mac-arm64', os: 'macos', arch: 'arm64', triple: 'aarch64-apple-darwin', label: 'macOS Apple Silicon' },
  'mac-x64': { id: 'mac-x64', os: 'macos', arch: 'x64', triple: 'x86_64-apple-darwin', label: 'macOS Intel' },
});

/** Target id for the machine we are running on, or null if we cannot build for it. */
function hostTargetId(platform = process.platform, arch = process.arch) {
  const os = { win32: 'win', darwin: 'mac' }[platform];
  const cpu = { x64: 'x64', arm64: 'arm64' }[arch];
  return os && cpu ? `${os}-${cpu}` : null;
}

/**
 * python-build-standalone triple of the machine we run on (also Linux, which is a build host
 * but not yet a target). Used for the tools the builder itself runs, like the analyzer.
 */
function hostTriple(platform = process.platform, arch = process.arch) {
  const table = {
    'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
    'linux-x64': 'x86_64-unknown-linux-gnu', 'linux-arm64': 'aarch64-unknown-linux-gnu',
  };
  return table[`${platform}-${arch}`] || null;
}

/**
 * Parses a comma-separated target list. Accepts ids, 'host' and 'all'.
 * @param {string|string[]|undefined} spec
 * @returns {Target[]}
 */
function parseTargets(spec) {
  const parts = (Array.isArray(spec) ? spec : String(spec || 'host').split(','))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out = [];
  for (const part of parts.length ? parts : ['host']) {
    const ids = part === 'all' ? Object.keys(TARGETS) : [part === 'host' ? hostTargetId() : part];
    for (const id of ids) {
      if (!id) throw new Error(`this computer (${process.platform}-${process.arch}) is not a supported target; pass --target explicitly (${Object.keys(TARGETS).join(', ')})`);
      if (id.startsWith('linux-')) throw new Error(`${id}: Linux targets are a planned stretch goal and not available yet`);
      const t = TARGETS[id];
      if (!t) throw new Error(`unknown target "${id}" (known: ${Object.keys(TARGETS).join(', ')})`);
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

module.exports = { TARGETS, hostTargetId, hostTriple, parseTargets };
