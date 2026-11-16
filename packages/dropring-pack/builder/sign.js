'use strict';
// --sign-cmd: Authenticode signing with the user's own tool (signtool, osslsigncode, jsign...).
// The template gets the file path in place of {file} (appended if absent) and runs in a shell.
// The command line is never logged because it may contain a password.
//
//   --sign-cmd "signtool sign /fd sha256 /a {file}"
//   --sign-cmd "osslsigncode sign -pkcs12 cert.p12 -pass env:PFX_PASS -in {file} -out {file}.signed && mv {file}.signed {file}"

const { spawn } = require('child_process');

function quote(file, platform = process.platform) {
  if (platform === 'win32') {
    if (/["%]/.test(file)) throw new Error(`cannot pass ${file} safely to a Windows shell`);
    return `"${file}"`;
  }
  return `'${file.replace(/'/g, `'\\''`)}'`;
}

function expand(template, file, platform = process.platform) {
  const q = quote(file, platform);
  return template.includes('{file}') ? template.split('{file}').join(q) : `${template} ${q}`;
}

/** Runs the signing command for one file; rejects with the exit code and the tail of stderr. */
function signFile(template, file, { signal, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(expand(template, file), { shell: true, windowsHide: true, signal, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const err = [];
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const tail = Buffer.concat(err).toString('utf8').trim().split(/\r?\n/).slice(-5).join('\n');
      reject(new Error(`--sign-cmd failed with exit code ${code}${tail ? `:\n${tail}` : ''}`));
    });
  });
}

module.exports = { signFile, expand, quote };
