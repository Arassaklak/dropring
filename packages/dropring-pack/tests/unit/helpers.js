'use strict';
// Shared test helpers: temporary folders and fake runtimes/launchers (no network, no Python).

const fs = require('fs');
const os = require('os');
const path = require('path');

// Unit tests never touch the user's cache or the network.
process.env.DROPRING_PACK_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'dropring-pack-test-cache-'));
process.env.DROPRING_PACK_OFFLINE = '1';
process.on('exit', () => fs.rmSync(process.env.DROPRING_PACK_CACHE, { recursive: true, force: true }));

/** A minimal but real PE executable with an application manifest, standing in for the launcher. */
async function fakePeLauncher(file) {
  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.createEmpty(false, false);
  const res = ResEdit.NtExecutableResource.from(exe);
  const manifest = '<?xml version="1.0" encoding="UTF-8"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings><longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware></windowsSettings></application></assembly>';
  res.entries.push({ type: 24, id: 1, lang: 1033, codepage: 0, bin: new Uint8Array(Buffer.from(manifest)).buffer });
  res.outputResource(exe);
  fs.writeFileSync(file, Buffer.from(exe.generate()));
  return file;
}

function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dropring-pack-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

/** A tiny stand-in for an extracted python-build-standalone runtime. */
function fakeRuntime(root, os_) {
  const files = os_ === 'windows'
    ? {
      'python/python314.dll': 'dll', 'python/python3.dll': 'dll', 'python/vcruntime140.dll': 'crt', 'python/LICENSE.txt': 'PSF',
      'python/python.exe': 'exe', 'python/pythonw.exe': 'exe', 'python/Scripts/pip.exe': 'exe', 'python/include/Python.h': 'h', 'python/libs/python314.lib': 'lib',
      'python/Lib/os.py': '#', 'python/Lib/json/__init__.py': '#', 'python/Lib/test/test_os.py': '#', 'python/Lib/unittest/test/test_case.py': '#',
      'python/Lib/tkinter/__init__.py': '#', 'python/Lib/idlelib/idle.py': '#', 'python/Lib/site-packages/pip/__init__.py': '#',
      'python/DLLs/_ssl.pyd': 'pyd', 'python/DLLs/libssl-3-x64.dll': 'dll', 'python/DLLs/_testcapi.pyd': 'pyd', 'python/DLLs/_tkinter.pyd': 'pyd',
      'python/DLLs/tcl90.dll': 'dll', 'python/tcl/tcl9.0/init.tcl': 'tcl',
    }
    : {
      'python/bin/python3.14': 'exe', 'python/include/python3.14/Python.h': 'h', 'python/share/man/man1/python3.1': 'man',
      'python/lib/libpython3.14.dylib': 'dylib', 'python/lib/libtcl9.0.dylib': 'dylib', 'python/lib/tcl9.0/init.tcl': 'tcl', 'python/lib/pkgconfig/python3.pc': 'pc',
      'python/lib/python3.14/os.py': '#', 'python/lib/python3.14/LICENSE.txt': 'PSF', 'python/lib/python3.14/config-3.14-darwin/libpython3.14.a': 'a',
      'python/lib/python3.14/lib-dynload/_tkinter.cpython-314-darwin.so': 'so', 'python/lib/python3.14/tkinter/__init__.py': '#',
      'python/lib/python3.14/test/test_os.py': '#', 'python/lib/python3.14/site-packages/pip/__init__.py': '#', 'python/lib/python3.14/ensurepip/__init__.py': '#',
    };
  writeFiles(root, files);
  return path.join(root, 'python');
}

const RUNTIME_SPEC = { minor: '3.14', version: '3.14.10', release: '20261110', triple: 'x', sha256: 'a'.repeat(64), url: 'https://example.invalid/x.tar.gz', filename: 'x.tar.gz', endOfLife: false };

/** A python3 on PATH for running the AST analyzer in tests, or null (those tests are skipped). */
function systemPython() {
  const { spawnSync } = require('child_process');
  for (const cmd of process.platform === 'win32' ? ['python', 'py'] : ['python3']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'True') return cmd;
  }
  return null;
}

module.exports = { tmpdir, writeFiles, fakeRuntime, fakePeLauncher, systemPython, RUNTIME_SPEC };
