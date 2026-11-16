'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const deps = require('../../builder/deps');
const { loadHooks, applyHooks, validate } = require('../../builder/hooks');
const { zipDirectory, readZipEntry } = require('../../builder/zip');
const { TARGETS } = require('../../builder/targets');
const { tmpdir, writeFiles, systemPython } = require('./helpers');

const PY = systemPython();
const REQUIREMENTS_PY = path.join(__dirname, '..', '..', 'builder', 'analyzer', 'requirements.py');

test('parseLock reads pinned versions and hashes', () => {
  const lock = 'certifi==2026.10.23 \\\n    --hash=sha256:' + 'a'.repeat(64) + ' \\\n    --hash=sha256:' + 'b'.repeat(64) + '\ncolorama==0.4.6 ; sys_platform == \'win32\' \\\n    --hash=sha256:' + 'c'.repeat(64) + '\n';
  assert.deepEqual(deps.parseLock(lock), [
    { name: 'certifi', version: '2026.10.23', hashes: ['a'.repeat(64), 'b'.repeat(64)] },
    { name: 'colorama', version: '0.4.6', hashes: ['c'.repeat(64)] },
  ]);
});

test('inference uses the allow-list only, with platform markers', () => {
  const analysis = { modules: {
    yaml: { kind: 'required', category: 'third-party', where: 'a.py:1' },
    win32api: { kind: 'conditional', category: 'third-party', where: 'a.py:2' },
    ujson: { kind: 'optional', category: 'third-party', where: 'a.py:3' },
    reqeusts: { kind: 'required', category: 'third-party', where: 'a.py:4' },
    os: { kind: 'required', category: 'stdlib', where: 'a.py:5' },
  } };
  const r = deps.infer(analysis);
  assert.deepEqual(r.specs, ["PyYAML", "pywin32; sys_platform == 'win32'"]);
  assert.deepEqual(r.unknown.map((u) => u.import), ['reqeusts'], 'a typo is never turned into an install');
});

test('missingImports: removed modules, undeclared and unknown packages', () => {
  const analysis = { modules: {
    distutils: { kind: 'required', category: 'third-party', where: 'm.py:1' },
    requests: { kind: 'required', category: 'third-party', where: 'm.py:2' },
    extra: { kind: 'deferred', category: 'third-party', where: 'm.py:3' },
  } };
  const r = deps.missingImports(analysis, new Set(['requests']), { python: '3.14', declared: true });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /m\.py:1: distutils was removed from the standard library in Python 3\.12; build with --python 3\.11/);
  assert.match(r.warnings[0], /m\.py:3: imports extra, but none of the declared dependencies provides it/);
  const u = deps.missingImports({ modules: { foo: { kind: 'required', category: 'third-party', where: 'x.py:9' } } }, new Set(), { python: '3.14', declared: false });
  assert.match(u.errors[0], /x\.py:9: imports foo, which is not a standard-library module and not on dropring-pack's list of known packages/);
});

function fakeDistribution(site, { name, version, files }) {
  const info = `${name}-${version}.dist-info`;
  const lines = [];
  for (const [rel, content] of Object.entries(files)) {
    writeFiles(site, { [rel]: content });
    lines.push(`${rel},sha256=${crypto.createHash('sha256').update(content).digest('base64url')},${Buffer.byteLength(content)}`);
  }
  writeFiles(site, {
    [`${info}/METADATA`]: `Metadata-Version: 2.4\nName: ${name}\nVersion: ${version}\nLicense-Expression: MIT\n\nlong description: with: colons\n`,
    [`${info}/WHEEL`]: 'Wheel-Version: 1.0\nTag: py3-none-any\n',
    'bin/tool': '#!/bin/sh\n',
  });
  lines.push(`${info}/METADATA,,`, `${info}/RECORD,,`, `bin/tool,sha256=${crypto.createHash('sha256').update('#!/bin/sh\n').digest('base64url')},10`);
  writeFiles(site, { [`${info}/RECORD`]: lines.join('\n') + '\n' });
}

test('verifyAndClean checks RECORD hashes, lists top-level names, drops bin/ and caches', async (t) => {
  const site = tmpdir(t);
  fakeDistribution(site, { name: 'demo-pkg', version: '1.0', files: { 'demo/__init__.py': 'x = 1\n', 'demo/data.txt': 'data', 'demo_single.py': '', 'demo/__pycache__/x.pyc': 'cache' } });
  const r = await deps.verifyAndClean(site);
  assert.deepEqual(r.distributions, [{ name: 'demo-pkg', version: '1.0', tag: 'py3-none-any', license: 'MIT', files: 4, topLevel: ['demo', 'demo_single'] }]);
  assert.deepEqual([...r.provided].sort(), ['demo', 'demo_single']);
  assert.ok(!fs.existsSync(path.join(site, 'bin')) && !fs.existsSync(path.join(site, 'demo', '__pycache__')));
  fs.writeFileSync(path.join(site, 'demo', 'data.txt'), 'tampered');
  await assert.rejects(deps.verifyAndClean(site), /demo\/data\.txt does not match its RECORD hash/);
});

test('uv environment: our cache, no user config, no stray UV_ variables', () => {
  const env = deps.uvEnv('/c', { PATH: '/bin', UV_INDEX_URL: 'https://evil.example', uv_cache_dir: '/x' });
  assert.equal(env.UV_CACHE_DIR, path.join('/c', 'uv'));
  assert.equal(env.UV_NO_CONFIG, '1');
  assert.equal(env.UV_INDEX_URL, undefined);
  assert.equal(env.uv_cache_dir, undefined);
  assert.equal(env.PYTHONDONTWRITEBYTECODE, '1');
  assert.equal(env.PATH, '/bin');
});

test('planDependencies: --requirements, --package, inference', async (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, { 'reqs.txt': 'requests\n' });
  const analysis = { analyzer: 'text', root: dir, entry: 'main.py', mode: 'file', modules: { yaml: { kind: 'required', category: 'third-party', where: 'main.py:1' } } };
  const a = await deps.planDependencies({ analysis, requirements: path.join(dir, 'reqs.txt') });
  assert.deepEqual([a.source, a.passthrough, a.specs], ['--requirements reqs.txt', [path.join(dir, 'reqs.txt')], []]);
  const b = await deps.planDependencies({ analysis, packages: ['rich>=13'] });
  assert.equal(b.source, 'inferred from imports + --package');
  assert.deepEqual(b.specs, ['PyYAML', 'rich>=13']);
  await assert.rejects(deps.planDependencies({ analysis, requirements: path.join(dir, 'nope.txt') }), /file not found/);
});

function readDeclared(root, entry, mode) {
  const r = spawnSync(PY, ['-I', '-S', '-B', '-X', 'utf8', REQUIREMENTS_PY], { input: JSON.stringify({ root, entry, mode }), encoding: 'utf8' });
  return r.status === 0 ? JSON.parse(r.stdout) : { error: r.stderr };
}

const hasTomllib = PY && spawnSync(PY, ['-c', 'import tomllib'], { encoding: 'utf8' }).status === 0;

test('declared dependencies: every format, never executing setup.py', { skip: !hasTomllib && 'no python3 >= 3.11 on PATH' }, (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, { 'p1/pyproject.toml': '[project]\nname="x"\nversion="1"\ndependencies=["requests>=2", "rich"]\n', 'p1/main.py': '' });
  assert.deepEqual(readDeclared(path.join(dir, 'p1'), 'main.py', 'project').requirements, ['requests>=2', 'rich']);
  writeFiles(dir, { 'p2/pyproject.toml': '[tool.poetry.dependencies]\npython="^3.10"\nrequests="^2.31"\nzeta="~1.2"\nalpha="0.3.1"\nopt={version="^1", optional=true}\nanyver="*"\nwithx={version="^0.2.3", extras=["fast"], markers="sys_platform == \'win32\'"}\n', 'p2/main.py': '' });
  assert.deepEqual(readDeclared(path.join(dir, 'p2'), 'main.py', 'project').requirements, ['requests>=2.31,<3', 'zeta>=1.2,<1.3', 'alpha==0.3.1', 'anyver', "withx[fast]>=0.2.3,<0.3; sys_platform == 'win32'"]);
  writeFiles(dir, { 'p3/setup.cfg': '[options]\ninstall_requires =\n    click>=8\n    # comment\n    colorama; platform_system == "Windows"\n', 'p3/setup.py': 'raise SystemExit("setup.py must never run")', 'p3/main.py': '' });
  assert.deepEqual(readDeclared(path.join(dir, 'p3'), 'main.py', 'project').requirements, ['click>=8', 'colorama; platform_system == "Windows"']);
  writeFiles(dir, { 'p4/Pipfile': '[packages]\nrequests = "*"\nflask = ">=3"\nrich = {version = "*", extras = ["jupyter"]}\n', 'p4/main.py': '' });
  assert.deepEqual(readDeclared(path.join(dir, 'p4'), 'main.py', 'project').requirements, ['requests', 'flask>=3', 'rich[jupyter]']);
  writeFiles(dir, { 'p5/requirements.txt': 'a\n', 'p5/s.py': '# /// script\n# dependencies = ["rich"]\n# ///\n' });
  assert.equal(readDeclared(path.join(dir, 'p5'), 's.py', 'file').source, 'PEP 723 block in s.py', 'a dropped script\'s own metadata wins');
  assert.equal(readDeclared(path.join(dir, 'p5'), 's.py', 'project').source, 'requirements.txt', 'in a project folder the project files win');
  writeFiles(dir, { 'p6/pyproject.toml': '[project]\nname="x"\nversion="1"\ndynamic=["dependencies"]\n', 'p6/main.py': '' });
  assert.match(readDeclared(path.join(dir, 'p6'), 'main.py', 'project').error, /dynamic/);
});

test('hooks: built-in set loads, validation is strict, matching is per target', (t) => {
  const hooks = loadHooks();
  assert.ok(hooks.size >= 10);
  assert.throws(() => validate({ schema: 1, package: 'x', stdlibb: [] }, 'h.json'), /unknown field "stdlibb"/);
  assert.throws(() => validate({ schema: 1, package: 'x', stdlib: ['numpy'] }, 'h.json'), /"stdlib" may contain/);
  const r = applyHooks(hooks, [{ name: 'CustomTkinter' }, { name: 'pywin32' }], TARGETS['mac-arm64']);
  assert.equal(r.keepTkinter, true);
  assert.deepEqual(r.applied.map((h) => h.package), ['customtkinter'], 'pywin32 hook is Windows-only');
  const dir = tmpdir(t);
  writeFiles(dir, { 'mine.json': JSON.stringify({ schema: 1, package: 'customtkinter', env: { CTK_THEME: 'dark' } }) });
  assert.deepEqual(applyHooks(loadHooks(dir), [{ name: 'customtkinter' }], TARGETS['win-x64']).env, { CTK_THEME: 'dark' });
});

test('readZipEntry reads back a stored or deflated file', async (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, { 'pkg/uv.exe': 'MZ' + 'x'.repeat(5000), 'pkg/LICENSE': 'MIT' });
  const zip = await zipDirectory(path.join(dir, 'pkg'), path.join(dir, 'a.zip'), { date: new Date(Date.UTC(2024, 0, 1)), modeOf: () => 0o644 });
  assert.equal((await readZipEntry(zip, 'uv.exe')).toString(), 'MZ' + 'x'.repeat(5000));
  await assert.rejects(readZipEntry(zip, 'missing.exe'), /not found/);
});
