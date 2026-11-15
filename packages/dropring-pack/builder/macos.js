'use strict';
// macOS bundle helpers: Info.plist, Mach-O minimum OS version, ad-hoc code signing.

const fs = require('fs');
const { execFile } = require('child_process');

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {{name: string, executable: string, appId: string, version: string, minOs: string,
 *          extra?: Record<string, string|boolean>}} o
 */
function infoPlist(o) {
  const entries = {
    CFBundleDevelopmentRegion: 'en',
    CFBundleDisplayName: o.name,
    CFBundleExecutable: o.executable,
    CFBundleIdentifier: o.appId,
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: o.name.slice(0, 15),
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: o.version,
    CFBundleVersion: o.version,
    LSMinimumSystemVersion: o.minOs,
    NSHighResolutionCapable: true,
    ...(o.extra || {}),
  };
  const body = Object.keys(entries).sort().map((k) => {
    const v = entries[k];
    return `\t<key>${xml(k)}</key>\n\t${typeof v === 'boolean' ? (v ? '<true/>' : '<false/>') : `<string>${xml(v)}</string>`}`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

const LC_VERSION_MIN_MACOSX = 0x24;
const LC_BUILD_VERSION = 0x32;
const versionString = (v) => `${v >>> 16}.${(v >>> 8) & 0xff}${v & 0xff ? `.${v & 0xff}` : ''}`;

/**
 * Minimum macOS version a thin 64-bit Mach-O declares (LC_BUILD_VERSION or
 * LC_VERSION_MIN_MACOSX), or null if it cannot be determined.
 * @param {Buffer} buf  start of the file (the load commands live in the first pages)
 */
function machoMinOs(buf) {
  if (buf.length < 32 || buf.readUInt32LE(0) !== 0xfeedfacf) return null; // MH_MAGIC_64, little-endian
  const ncmds = buf.readUInt32LE(16);
  let off = 32;
  for (let i = 0; i < ncmds && off + 8 <= buf.length; i++) {
    const cmd = buf.readUInt32LE(off);
    const size = buf.readUInt32LE(off + 4);
    if (cmd === LC_BUILD_VERSION && off + 16 <= buf.length) return versionString(buf.readUInt32LE(off + 12));
    if (cmd === LC_VERSION_MIN_MACOSX && off + 12 <= buf.length) return versionString(buf.readUInt32LE(off + 8));
    if (size < 8) return null;
    off += size;
  }
  return null;
}

async function machoMinOsOfFile(file) {
  const fd = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
    return machoMinOs(buf.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }
}

/** Compares dotted versions numerically. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(' ')} failed: ${String(stderr || err.message).trim()}`));
      else resolve({ stdout, stderr });
    });
  });
}

/** Ad-hoc signs the bundle (main executable + resource seal) and verifies it. macOS hosts only. */
async function codesignAdhoc(appPath) {
  await run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', appPath]);
  await run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', appPath]);
}

module.exports = { infoPlist, machoMinOs, machoMinOsOfFile, compareVersions, codesignAdhoc };
