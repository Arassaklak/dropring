'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { download } = require('../../builder/download');
const { infoPlist, machoMinOs, compareVersions } = require('../../builder/macos');
const { tmpdir } = require('./helpers');

function serve(t, body) {
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.writeHead(200, { 'content-length': body.length }); res.end(body); });
  t.after(() => server.close());
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/f.tar.gz`, hits: () => hits })));
}

test('download: verifies, caches, re-fetches a tampered cache entry', async (t) => {
  const body = crypto.randomBytes(100000);
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const srv = await serve(t, body);
  const dest = path.join(tmpdir(t), 'cache', 'f.tar.gz');
  let progress = 0;
  assert.deepEqual(await download({ url: srv.url, dest, sha256, env: {}, onProgress: (r) => { progress = r; } }), { path: dest, cached: false });
  assert.equal(progress, body.length);
  assert.deepEqual(await download({ url: srv.url, dest, sha256, env: {} }), { path: dest, cached: true });
  assert.equal(srv.hits(), 1);
  fs.writeFileSync(dest, 'tampered');
  assert.equal((await download({ url: srv.url, dest, sha256, env: {} })).cached, false);
  assert.equal(srv.hits(), 2);
  assert.ok(fs.readFileSync(dest).equals(body));
});

test('download: a hash mismatch leaves nothing behind', async (t) => {
  const srv = await serve(t, Buffer.from('evil'));
  const dir = tmpdir(t);
  const dest = path.join(dir, 'f.tar.gz');
  await assert.rejects(download({ url: srv.url, dest, sha256: 'b'.repeat(64), retries: 1, env: {} }), { code: 'HASH_MISMATCH' });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('download: refuses plain HTTP to remote hosts, missing pins and offline fetches', async (t) => {
  const dest = path.join(tmpdir(t), 'x');
  await assert.rejects(download({ url: 'http://example.com/x', dest, sha256: 'c'.repeat(64), env: {} }), /HTTPS required/);
  await assert.rejects(download({ url: 'https://example.com/x', dest, sha256: 'nope', env: {} }), /no valid pinned SHA-256/);
  await assert.rejects(download({ url: 'https://example.com/x', dest, sha256: 'c'.repeat(64), env: { DROPRING_PACK_OFFLINE: '1' } }), /offline mode/);
});

test('Info.plist is sorted and escaped', () => {
  const p = infoPlist({ name: 'A & <B>', executable: 'A & B', appId: 'com.example.ab', version: '1.2.3', minOs: '11.0' });
  assert.match(p, /<key>CFBundleDisplayName<\/key>\n\t<string>A &amp; &lt;B&gt;<\/string>/);
  assert.match(p, /<key>NSHighResolutionCapable<\/key>\n\t<true\/>/);
  assert.ok(p.indexOf('CFBundleDevelopmentRegion') < p.indexOf('LSMinimumSystemVersion'));
});

test('machoMinOs reads LC_BUILD_VERSION and LC_VERSION_MIN_MACOSX', () => {
  const mk = (cmd, version) => {
    const b = Buffer.alloc(32 + 24);
    b.writeUInt32LE(0xfeedfacf, 0);
    b.writeUInt32LE(1, 16); // ncmds
    b.writeUInt32LE(cmd, 32);
    b.writeUInt32LE(24, 36);
    b.writeUInt32LE(version, cmd === 0x32 ? 44 : 40);
    return b;
  };
  assert.equal(machoMinOs(mk(0x32, (11 << 16) | (0 << 8))), '11.0');
  assert.equal(machoMinOs(mk(0x24, (10 << 16) | (13 << 8) | 4)), '10.13.4');
  assert.equal(machoMinOs(Buffer.from('MZ not a mach-o file at all, but long enough..')), null);
  assert.ok(compareVersions('10.13', '11.0') < 0 && compareVersions('11.0', '11') === 0);
});
