'use strict';
// Shared test helpers: temporary folders and fake runtimes/launchers (no network, no Python).

const fs = require('fs');
const os = require('os');
const path = require('path');

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

module.exports = { tmpdir, writeFiles, fakeRuntime, RUNTIME_SPEC };
