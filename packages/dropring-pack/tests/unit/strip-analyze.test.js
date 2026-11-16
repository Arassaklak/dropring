'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { runtimeFilter } = require('../../builder/strip');
const { analyze, scanImports, skipReason } = require('../../builder/analyze');
const { tmpdir, writeFiles } = require('./helpers');

test('strip: Windows rules', () => {
  const drop = runtimeFilter({ os: 'windows', minor: '3.14', keepTkinter: false });
  for (const kept of ['python314.dll', 'python3.dll', 'vcruntime140.dll', 'Lib/os.py', 'Lib/json/__init__.py', 'DLLs/_ssl.pyd', 'DLLs/libssl-3-x64.dll', 'LICENSE.txt', 'Lib/unittest/case.py']) {
    assert.equal(drop(kept), null, `${kept} must be kept`);
  }
  for (const gone of ['python.exe', 'pythonw.exe', 'Scripts/pip.exe', 'include/Python.h', 'libs/python314.lib', 'Lib/test/test_os.py', 'Lib/unittest/test/test_case.py',
    'Lib/site-packages/pip/__init__.py', 'Lib/ensurepip/__init__.py', 'Lib/idlelib/idle.py', 'DLLs/_testcapi.pyd', 'DLLs/_ctypes_test.pyd',
    'DLLs/_tkinter.pyd', 'DLLs/tcl90.dll', 'DLLs/tcl9tk90.dll', 'tcl/tcl9.0/init.tcl', 'Lib/tkinter/__init__.py', 'Lib/turtle.py']) {
    assert.notEqual(drop(gone), null, `${gone} must be dropped`);
  }
  const keepTk = runtimeFilter({ os: 'windows', minor: '3.14', keepTkinter: true });
  for (const kept of ['DLLs/_tkinter.pyd', 'DLLs/tcl90.dll', 'tcl/tcl9.0/init.tcl', 'Lib/tkinter/__init__.py']) assert.equal(keepTk(kept), null);
});

test('strip: macOS rules', () => {
  const drop = runtimeFilter({ os: 'macos', minor: '3.14', keepTkinter: false });
  for (const kept of ['lib/libpython3.14.dylib', 'lib/python3.14/os.py', 'lib/python3.14/LICENSE.txt', 'lib/python3.14/lib-dynload/_dbm.cpython-314-darwin.so', 'lib/python3.14/site-packages']) {
    assert.equal(drop(kept), null, `${kept} must be kept`);
  }
  for (const gone of ['bin/python3.14', 'include/python3.14/Python.h', 'share/man/man1/python3.1', 'lib/pkgconfig/python3.pc',
    'lib/python3.14/config-3.14-darwin/Makefile', 'lib/python3.14/site-packages/pip/__init__.py', 'lib/python3.14/test/test_os.py',
    'lib/python3.14/lib-dynload/_tkinter.cpython-314-darwin.so', 'lib/libtcl9.0.dylib', 'lib/libtcl9tk9.0.dylib', 'lib/tcl9.0/init.tcl', 'lib/tk9.0/tk.tcl',
    'lib/itcl4.3.8/itcl.tcl', 'lib/thread3.0.6/pkgIndex.tcl', 'lib/python3.14/__pycache__/os.cpython-314.opt-1.pyc']) {
    assert.notEqual(drop(gone), null, `${gone} must be dropped`);
  }
});

test('scanImports finds absolute top-level imports only', () => {
  const src = [
    'import os, sys as system', 'import json.decoder', 'from collections import abc', 'from . import sibling', 'from .pkg import x',
    '    import tkinter as tk  # indented, inside a function', 'from greeting import (\n  message,\n)', '# import commented', 'x = "import fake"',
  ].join('\n');
  assert.deepEqual([...scanImports(src)].sort(), ['collections', 'greeting', 'json', 'os', 'sys', 'tkinter']);
});

test('analyze: single file pulls in local modules and packages, detects tkinter', async (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, {
    'main.py': 'import helper\nfrom pkg import thing\nimport requests\n',
    'helper.py': 'import tkinter\n',
    'pkg/__init__.py': 'from pkg import sub\n',
    'pkg/sub.py': '',
    'pkg/data.json': '{}',
    'pkg/__pycache__/sub.cpython-314.pyc': 'x',
    'unrelated.py': '',
  });
  const a = await analyze(path.join(dir, 'main.py'), { textOnly: true });
  assert.equal(a.mode, 'file');
  assert.deepEqual(a.files, ['helper.py', 'main.py', 'pkg/__init__.py', 'pkg/data.json', 'pkg/sub.py']);
  assert.equal(a.usesTkinter, true);
  assert.ok(a.imports.includes('requests'));
});

test('analyze: project folder copies the tree, skips caches, venvs and .env', async (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, {
    'app.py': 'print(1)\n', 'lib/util.py': '', 'assets/logo.txt': 'x', '.env': 'SECRET=1', '.venv/bin/python': 'x',
    '.git/HEAD': 'x', '__pycache__/app.cpython-314.pyc': 'x', 'notes.md': 'x', 'dist/old.txt': 'x',
  });
  const a = await analyze(dir, { exclude: [path.join(dir, 'out')], textOnly: true });
  assert.equal(a.mode, 'project');
  assert.equal(a.entry, 'app.py');
  assert.deepEqual(a.files, ['app.py', 'assets/logo.txt', 'lib/util.py', 'notes.md']);
  assert.ok(a.warnings.some((w) => w.includes('.env')));
  assert.equal(a.usesTkinter, false);
  await assert.rejects(analyze(path.join(dir, 'lib'), { textOnly: true }), /no entry script/);
  await assert.rejects(analyze(path.join(dir, 'notes.md'), { textOnly: true }), /expected a \.py file/);
  assert.equal(skipReason('node_modules', true), 'tooling or cache folder');
});
