'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTargets, hostTargetId, TARGETS } = require('../../builder/targets');
const { resolveRuntime, listRuntimes, runtimeLayout, MANIFEST } = require('../../builder/runtime');

test('targets: ids, host, all, errors', () => {
  assert.deepEqual(parseTargets('win-x64, mac-arm64').map((t) => t.id), ['win-x64', 'mac-arm64']);
  assert.equal(parseTargets('all').length, 4);
  assert.equal(parseTargets('win-x64,win-x64').length, 1);
  assert.equal(hostTargetId('win32', 'x64'), 'win-x64');
  assert.equal(hostTargetId('darwin', 'arm64'), 'mac-arm64');
  assert.equal(hostTargetId('linux', 'ia32'), null);
  assert.throws(() => parseTargets('amiga-68k'), /unknown target/);
  assert.throws(() => parseTargets('linux-x64'), /stretch goal/);
});

test('runtimes.json: every pin is a SHA-256 for a known triple, default exists', () => {
  const triples = new Set([...Object.values(TARGETS).map((t) => t.triple), 'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu']);
  assert.ok(MANIFEST.runtimes[MANIFEST.default], 'default runtime is pinned');
  for (const [minor, r] of Object.entries(MANIFEST.runtimes)) {
    assert.match(r.version, new RegExp(`^${minor.replace('.', '\\.')}\\.\\d+$`));
    assert.match(r.release, /^\d{8}$/);
    for (const [triple, sha] of Object.entries(r.assets)) {
      assert.ok(triples.has(triple), `${minor}: unexpected triple ${triple}`);
      assert.match(sha, /^[0-9a-f]{64}$/);
    }
  }
  assert.ok(listRuntimes().some((r) => r.minor === '3.10' && r.endOfLife));
});

test('resolveRuntime: URL, mirror, versions, missing builds', () => {
  const mac = TARGETS['mac-arm64'];
  const r = resolveRuntime('3.14', mac, {});
  assert.equal(r.url, `https://github.com/astral-sh/python-build-standalone/releases/download/${r.release}/cpython-${r.version}%2B${r.release}-aarch64-apple-darwin-install_only_stripped.tar.gz`);
  assert.equal(resolveRuntime(undefined, mac, {}).minor, MANIFEST.default);
  assert.equal(resolveRuntime(r.version, mac, {}).version, r.version);
  const mirrored = resolveRuntime('3.14', mac, { DROPRING_PACK_RUNTIME_MIRROR: 'https://mirror.example/pbs/' });
  assert.ok(mirrored.url.startsWith(`https://mirror.example/pbs/${r.release}/cpython-`));
  assert.throws(() => resolveRuntime('3.14.0', mac, {}), /not pinned/);
  assert.throws(() => resolveRuntime('3.9', mac, {}), /not available/);
  assert.throws(() => resolveRuntime('2.7', mac, {}), /invalid Python version/);
  assert.throws(() => resolveRuntime('banana', mac, {}), /invalid Python version/);
  assert.throws(() => resolveRuntime('3.10', TARGETS['win-arm64'], {}), /no build for Windows ARM64/);
});

test('runtimeLayout names the shared library per OS', () => {
  assert.deepEqual(runtimeLayout({ minor: '3.14' }, 'windows'), { lib: 'python314.dll', pth: 'python314._pth' });
  assert.deepEqual(runtimeLayout({ minor: '3.10' }, 'macos'), { lib: 'lib/libpython3.10.dylib', pth: null });
});
