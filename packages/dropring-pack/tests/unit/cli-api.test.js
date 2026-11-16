'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseArgs } = require('../../builder/cli');
const { build } = require('../../builder');
const { tmpdir, writeFiles } = require('./helpers');

test('CLI argument parsing', () => {
  const o = parseArgs(['build', 'app.py', '--target', 'win-x64,mac-arm64', '--name=My App', '--windowed', '--python', '3.13', '--no-utf8-mode', '--include', 'a=b', '--include=c=d', '--hidden-import', 'x,y', '--hidden-import', 'z', '--dpi-aware']);
  assert.deepEqual(o, { _: ['build', 'app.py'], targets: 'win-x64,mac-arm64', name: 'My App', windowed: true, python: '3.13', utf8Mode: false, include: ['a=b', 'c=d'], hiddenImports: ['x', 'y', 'z'], dpiAware: true });
  assert.throws(() => parseArgs(['build', '--bogus']), /unknown option/);
  assert.throws(() => parseArgs(['build', 'a.py', '--name']), /needs a value/);
});

test('API rejects planned-but-missing options and bad metadata before doing any work', async (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, { 'a.py': 'print(1)\n' });
  const entry = path.join(dir, 'a.py');
  const base = { entry, targets: 'win-x64', out: path.join(dir, 'out'), processEnv: { DROPRING_PACK_OFFLINE: '1', DROPRING_PACK_CACHE: path.join(dir, 'cache') } };
  await assert.rejects(build({ ...base, requirements: 'requirements.txt' }), /planned for M2/);
  await assert.rejects(build({ ...base, targets: 'mac-arm64', signCmd: 'sign {file}' }), /--sign-cmd signs Windows executables/);
  await assert.rejects(build({ ...base, mode: 'onefile' }), /planned for M4/);
  await assert.rejects(build({ ...base, version: '1.0-beta' }), /must be numeric/);
  await assert.rejects(build({ ...base, appId: 'not a dns id' }), /reverse-DNS/);
  await assert.rejects(build({ ...base, macSign: 'identity:Me' }), /planned for M3/);
  await assert.rejects(build({ ...base, flat: true, targets: 'win-x64,mac-x64' }), /exactly one target/);
  const events = [];
  await assert.rejects(build(base, (e) => events.push(e)), /offline mode/);
  assert.deepEqual(events.filter((e) => e.type === 'stage').map((e) => e.stage), ['analyze', 'resolve', 'fetch']);
});
