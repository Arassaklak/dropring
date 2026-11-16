'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { ANALYZER } = require('../../builder/analyze');
const { checkAnalysis, checkTarget, guiHint } = require('../../builder/checks');
const { asciiExecutableName } = require('../../builder/assemble');
const { TARGETS } = require('../../builder/targets');
const { tmpdir, writeFiles, systemPython } = require('./helpers');

const PY = systemPython();

function runAnalyzer(root, entry, extra = {}) {
  const r = spawnSync(PY, ['-I', '-S', '-B', '-X', 'utf8', ANALYZER], { input: JSON.stringify({ root, mode: 'file', entry, hidden: [], exclude: [], ...extra }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('AST analyzer: import kinds, local files, dynamic imports, GUI', { skip: !PY && 'no python3 >= 3.10 on PATH' }, (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, {
    'main.py': [
      'import os, sys', 'from pkg import thing', 'from typing import TYPE_CHECKING', 'if TYPE_CHECKING:', '    import numpy',
      'try:', '    import ujson', 'except ImportError:', '    ujson = None', 'if sys.platform == "win32":', '    import winreg',
      'def later():', '    import requests', 'import importlib', 'importlib.import_module("helper")', 'importlib.import_module(os.environ["X"])',
      'if __name__ == "__main__":', '    import tkinter',
    ].join('\n'),
    'pkg/__init__.py': 'from . import sub\n', 'pkg/sub.py': 'thing = 1\n', 'pkg/data.txt': 'x', 'helper.py': 'import csv\n',
    'broken/never_imported.py': 'def f(:\n',
  });
  const r = runAnalyzer(dir, 'main.py');
  assert.deepEqual(r.files, ['helper.py', 'main.py', 'pkg/__init__.py', 'pkg/data.txt', 'pkg/sub.py']);
  const kind = (m) => r.modules[m] && `${r.modules[m].kind}/${r.modules[m].category}`;
  assert.equal(kind('numpy'), 'typing/third-party');
  assert.equal(kind('ujson'), 'optional/third-party');
  assert.equal(kind('winreg'), 'conditional/stdlib');
  assert.equal(kind('requests'), 'deferred/third-party');
  assert.equal(kind('helper'), 'required/local');
  assert.equal(kind('pkg'), 'required/local');
  assert.equal(kind('tkinter'), 'required/stdlib');
  assert.equal(r.dynamic.length, 1);
  assert.match(r.dynamic[0].where, /^main\.py:16$/);
  assert.deepEqual(r.gui, ['tkinter']);
  assert.equal(r.usesTkinter, true);
  assert.deepEqual(r.syntaxErrors, [], 'files outside the import graph are not parsed');
});

test('AST analyzer: syntax errors, shadowing, relative import in the entry script', { skip: !PY && 'no python3 >= 3.10 on PATH' }, (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, { 'main.py': 'import json\nfrom . import x\nimport bad\n', 'json.py': 'X = 1\n', 'bad.py': 'def f(:\n' });
  const r = runAnalyzer(dir, 'main.py', { hidden: ['queue'] });
  assert.equal(r.syntaxErrors.length, 1);
  assert.match(r.syntaxErrors[0].where, /^bad\.py:1:/);
  assert.ok(r.warnings.some((w) => /shadows the standard library/.test(w)));
  assert.ok(r.warnings.some((w) => /relative import beyond the top-level package/.test(w)));
  assert.equal(r.modules.queue.where, '--hidden-import');
});

test('checks: missing, removed and OS-specific modules', () => {
  const analysis = {
    analyzer: 'ast',
    syntaxErrors: [{ where: 'bad.py:1:7', message: 'invalid syntax' }],
    modules: {
      requests: { kind: 'required', category: 'third-party', where: 'main.py:1' },
      ujson: { kind: 'optional', category: 'third-party', where: 'main.py:2' },
      distutils: { kind: 'required', category: 'third-party', where: 'main.py:3' },
      winreg: { kind: 'required', category: 'stdlib', where: 'main.py:4' },
      fcntl: { kind: 'conditional', category: 'stdlib', where: 'main.py:5' },
      numpy: { kind: 'typing', category: 'third-party', where: 'main.py:6' },
    },
    dynamic: [{ where: 'main.py:9', expression: 'importlib.import_module(name)' }],
    gui: ['tkinter'],
  };
  const g = checkAnalysis(analysis, { python: '3.14' });
  assert.equal(g.errors.length, 3, g.errors.join('\n'));
  assert.ok(g.errors.some((e) => /bad\.py:1:7/.test(e)));
  assert.ok(g.errors.some((e) => /requests, a third-party package.*--exclude-module requests/.test(e)));
  assert.ok(g.errors.some((e) => /distutils, which was removed .* 3\.12; build with --python 3\.11/.test(e)));
  assert.ok(g.warnings.some((w) => /ujson/.test(w)) && g.warnings.some((w) => /--hidden-import/.test(w)));
  assert.ok(!g.warnings.some((w) => /numpy/.test(w)), 'type-only imports are ignored');
  assert.equal(checkTarget(analysis, TARGETS['mac-arm64']).errors.length, 1);
  assert.equal(checkTarget(analysis, TARGETS['win-x64']).errors.length, 0, 'fcntl is only conditional');
  assert.match(guiHint(analysis, undefined), /--windowed/);
  assert.equal(guiHint(analysis, false), null);
});

test('macOS executable names are ASCII', () => {
  assert.equal(asciiExecutableName('Ünïcode Äpp'), 'Unicode App');
  assert.equal(asciiExecutableName('Işık Çağrı'), 'Isik Cagri');
  assert.equal(asciiExecutableName('日本'), 'App');
  assert.equal(asciiExecutableName('Plain Name'), 'Plain Name');
});

test('analyze() falls back to the text scan when no runtime can be fetched', async (t) => {
  const { analyze } = require('../../builder/analyze');
  const dir = tmpdir(t);
  writeFiles(dir, { 'main.py': 'import helper\n', 'helper.py': '' });
  const a = await analyze(path.join(dir, 'main.py'), { python: '3.14' }); // offline in tests
  assert.equal(a.analyzer, 'text');
  assert.ok(a.warnings.some((w) => /AST analysis unavailable/.test(w)));
  assert.deepEqual(a.files, ['helper.py', 'main.py']);
});
