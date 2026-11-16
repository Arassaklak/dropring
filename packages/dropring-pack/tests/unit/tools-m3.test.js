'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { ensureTool, TOOLS } = require('../../builder/tools');
const { macSigner } = require('../../builder/macos');
const { versionSkew } = require('../../builder');
const { hostTriple } = require('../../builder/targets');
const { tmpdir, writeFiles } = require('./helpers');

test('pinned tools: verified download, extraction, caching, override', async (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, { 'src/fakecli-1.0/fakecli': '#!/bin/sh\necho fake\n', 'src/fakecli-1.0/README': 'x' });
  const archive = path.join(dir, 'fakecli.tar.gz');
  await require('tar').c({ gzip: true, file: archive, cwd: path.join(dir, 'src'), portable: true }, ['fakecli-1.0']);
  const body = fs.readFileSync(archive);
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.end(body); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); delete TOOLS.fakecli; });
  TOOLS.fakecli = {
    version: '1.0', urlTemplate: `http://127.0.0.1:${server.address().port}/{file}`,
    assets: { [hostTriple()]: { file: 'fakecli.tar.gz', sha256: crypto.createHash('sha256').update(body).digest('hex'), size: body.length } },
  };
  const cacheDir = path.join(dir, 'cache');
  const exe = await ensureTool('fakecli', { env: {}, cacheDir });
  assert.equal(path.basename(exe), process.platform === 'win32' ? 'fakecli.exe' : 'fakecli');
  assert.equal(fs.readFileSync(exe, 'utf8'), '#!/bin/sh\necho fake\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(exe).mode & 0o111, 0o111);
  assert.equal(await ensureTool('fakecli', { env: {}, cacheDir }), exe);
  assert.equal(hits, 1, 'second call uses the cache');
  assert.equal(await ensureTool('fakecli', { env: { DROPRING_PACK_FAKECLI: '/opt/mine' }, cacheDir }), '/opt/mine');
  TOOLS.fakecli.assets[hostTriple()].sha256 = 'f'.repeat(64);
  await assert.rejects(ensureTool('fakecli', { env: {}, cacheDir: path.join(dir, 'cache2') }), { code: 'HASH_MISMATCH' });
});

test('tools.json pins uv and rcodesign for every build host', () => {
  for (const name of ['uv', 'rcodesign']) {
    for (const triple of ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu']) {
      assert.match(TOOLS[name].assets[triple].sha256, /^[0-9a-f]{64}$/, `${name} ${triple}`);
    }
  }
});

test('macOS signer: Apple codesign on Macs, rcodesign elsewhere, overridable', () => {
  assert.equal(macSigner({}), process.platform === 'darwin' ? 'codesign' : 'rcodesign');
  assert.equal(macSigner({ DROPRING_PACK_MAC_SIGNER: 'rcodesign' }), 'rcodesign');
});

test('version skew between targets is reported', () => {
  const m = new Map([
    ['cryptography', new Map([['50.0.2', ['win-x64', 'mac-arm64']], ['46.0.3', ['win-arm64']]])],
    ['requests', new Map([['2.34.2', ['win-x64', 'win-arm64']]])],
  ]);
  const w = versionSkew(m);
  assert.equal(w.length, 1);
  assert.match(w[0], /^cryptography resolved to different versions per target: 50\.0\.2 \(win-x64, mac-arm64\), 46\.0\.3 \(win-arm64\)/);
});
