'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { assembleOnedir, launcherConfig } = require('../../builder/assemble');
const { analyze } = require('../../builder/analyze');
const { TARGETS } = require('../../builder/targets');
const { tmpdir, writeFiles, fakeRuntime, fakePeLauncher, RUNTIME_SPEC } = require('./helpers');
const { readBranding } = require('../../builder/windows');

async function setup(t, os_) {
  const dir = tmpdir(t);
  const runtimeRoot = fakeRuntime(path.join(dir, 'rt'), os_);
  writeFiles(dir, { 'src/main.py': 'import helper\nprint("hi")\n', 'src/helper.py': '', 'launcher.bin': 'LAUNCHER' });
  if (os_ === 'windows') await fakePeLauncher(path.join(dir, 'launcher.bin'));
  const analysis = await analyze(path.join(dir, 'src', 'main.py'), { textOnly: true });
  const events = [];
  const opts = (destDir) => ({
    target: TARGETS[os_ === 'windows' ? 'win-x64' : 'mac-x64'],
    runtime: RUNTIME_SPEC,
    runtimeRoot,
    launcher: { path: path.join(dir, 'launcher.bin'), sha256: 'd'.repeat(64), version: '0.1.0', kind: 'console' },
    analysis,
    app: { name: 'My App', appId: 'com.example.myapp', version: '1.2.3', windowed: false, utf8Mode: true },
    destDir,
    macSign: 'none',
    emit: (e) => events.push(e),
    env: { SOURCE_DATE_EPOCH: '1700000000' },
  });
  return { dir, opts, events };
}

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('Windows onedir layout, launcher config and ._pth', async (t) => {
  const { dir, opts } = await setup(t, 'windows');
  const a = await assembleOnedir(opts(path.join(dir, 'out')));
  const root = path.join(dir, 'out', 'My App');
  assert.equal(a.path, root);
  assert.equal(a.executable, path.join(root, 'My App.exe'));
  const branding = await readBranding(path.join(root, 'My App.exe'));
  assert.equal(branding.strings.ProductName, 'My App');
  assert.equal(branding.strings.FileVersion, '1.2.3');
  assert.equal(branding.strings.OriginalFilename, 'My App.exe');
  const base = path.join(root, '_internal');
  assert.equal(read(base, 'python', 'python314._pth').split('\n').slice(1).join('\n'), 'Lib\nDLLs\nimport site\n');
  assert.equal(read(base, 'dropring-pack.cfg'), launcherConfig({ target: TARGETS['win-x64'], runtime: RUNTIME_SPEC, layout: { lib: 'python314.dll' }, utf8Mode: true }));
  assert.match(read(base, 'dropring-pack.cfg'), /python\.lib=python\/python314\.dll\nboot=pack\/boot\.py\nflag=-I\nflag=-B\nflag=-X\nflag=utf8\n$/);
  assert.doesNotMatch(read(base, 'dropring-pack.cfg'), /python\.home/);
  for (const f of ['app/main.py', 'app/helper.py', 'pack/boot.py', 'pack/dropring_pack_runtime.py', 'python/Lib/os.py', 'python/DLLs/_ssl.pyd']) assert.ok(fs.existsSync(path.join(base, f)), f);
  for (const f of ['python/python.exe', 'python/Scripts', 'python/Lib/test', 'python/tcl', 'python/DLLs/_testcapi.pyd', 'python/Lib/site-packages/pip']) assert.ok(!fs.existsSync(path.join(base, f)), `${f} should be stripped`);
  const info = JSON.parse(read(base, 'pack', 'app.json'));
  assert.deepEqual(info, { format: 1, name: 'My App', appId: 'com.example.myapp', version: '1.2.3', entry: 'app/main.py', mode: 'onedir', subsystem: 'console', packVersion: info.packVersion });
  const m = JSON.parse(read(base, 'manifest.json'));
  assert.equal(m.engine, 'dropring-pack');
  assert.equal(m.launcher.sha256, 'd'.repeat(64));
  assert.ok(!m.files.some((f) => f.path === 'My App.exe'), 'the executable is identified by the launcher hash');
  assert.ok(m.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.equal(fs.statSync(path.join(base, 'app', 'main.py')).mtimeMs, 1700000000 * 1000);
  const outer = JSON.parse(read(a.manifestPath));
  assert.ok(outer.files.some((f) => f.path === 'My App.exe'));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'out')).sort(), ['My App', 'My App.manifest.json'], 'no staging folder is left behind');
});

test('macOS bundle layout and Info.plist', async (t) => {
  const { dir, opts } = await setup(t, 'macos');
  const a = await assembleOnedir(opts(path.join(dir, 'out')));
  const app = path.join(dir, 'out', 'My App.app');
  assert.equal(a.executable, path.join(app, 'Contents', 'MacOS', 'My App'));
  const plist = read(app, 'Contents', 'Info.plist');
  assert.match(plist, /<key>CFBundleExecutable<\/key>\n\t<string>My App<\/string>/);
  assert.match(plist, /<key>LSMinimumSystemVersion<\/key>\n\t<string>10\.13<\/string>/);
  const base = path.join(app, 'Contents', 'Resources');
  assert.match(read(base, 'dropring-pack.cfg'), /python\.lib=python\/lib\/libpython3\.14\.dylib\npython\.home=python\nboot=pack\/boot\.py\nflag=-s\nflag=-B\n/);
  for (const f of ['python/bin', 'python/include', 'python/share', 'python/lib/tcl9.0', 'python/lib/libtcl9.0.dylib', 'python/lib/python3.14/test', 'python/lib/python3.14/config-3.14-darwin']) {
    assert.ok(!fs.existsSync(path.join(base, f)), `${f} should be stripped`);
  }
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(a.executable).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(base, 'python', 'lib', 'libpython3.14.dylib')).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(base, 'app', 'main.py')).mode & 0o777, 0o644);
  }
});

test('builds are deterministic', async (t) => {
  const { dir, opts } = await setup(t, 'windows');
  const a = await assembleOnedir(opts(path.join(dir, 'one')));
  const b = await assembleOnedir(opts(path.join(dir, 'two')));
  assert.equal(read(a.manifestPath), read(b.manifestPath));
});

test('replaces its own previous output but never a foreign folder', async (t) => {
  const { dir, opts } = await setup(t, 'windows');
  const out = path.join(dir, 'out');
  await assembleOnedir(opts(out));
  fs.writeFileSync(path.join(out, 'My App', 'stale.txt'), 'old');
  await assembleOnedir(opts(out));
  assert.ok(!fs.existsSync(path.join(out, 'My App', 'stale.txt')), 'previous output replaced');
  const foreign = path.join(dir, 'foreign');
  writeFiles(foreign, { 'My App/important.txt': 'keep me' });
  await assert.rejects(assembleOnedir(opts(foreign)), /was not created by dropring-pack/);
  assert.equal(read(foreign, 'My App', 'important.txt'), 'keep me');
});

test('a failed build leaves no staging folder', async (t) => {
  const { dir, opts } = await setup(t, 'windows');
  const o = opts(path.join(dir, 'out'));
  fs.rmSync(path.join(o.runtimeRoot, 'python314.dll'));
  await assert.rejects(assembleOnedir(o), /has no python314\.dll/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'out')), []);
});
