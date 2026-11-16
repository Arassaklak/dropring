'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { brandExe, readBranding, versionParts, withDpiAwareness } = require('../../builder/windows');
const { makeIco } = require('../../builder/icons');
const { resolveIncludes, parseSpec, globToRegExp } = require('../../builder/include');
const { zipDirectory } = require('../../builder/zip');
const { signFile, expand } = require('../../builder/sign');
const { testIconImage } = require('../test-icon');
const { tmpdir, writeFiles, fakePeLauncher } = require('./helpers');

test('PE branding: version strings, icon group, DPI-aware manifest', async (t) => {
  const exe = await fakePeLauncher(path.join(tmpdir(t), 'App.exe'));
  await brandExe(exe, { name: 'Çay Saati', version: '2.1', exeName: 'Çay Saati.exe', company: 'Örnek A.Ş.', copyright: '© 2026', ico: makeIco(testIconImage(256)), dpiAware: true });
  const b = await readBranding(exe);
  assert.equal(b.strings.ProductName, 'Çay Saati');
  assert.equal(b.strings.FileVersion, '2.1');
  assert.equal(b.strings.CompanyName, 'Örnek A.Ş.');
  assert.equal(b.strings.OriginalFilename, 'Çay Saati.exe');
  assert.deepEqual(b.iconSizes, [16, 24, 32, 48, 64, 128, 256]);
  assert.match(b.manifest, /PerMonitorV2/);
  assert.match(b.manifest, /longPathAware/);
  await brandExe(exe, { name: 'Again', version: '1.0', exeName: 'Again.exe' });
  assert.equal((await readBranding(exe)).strings.ProductName, 'Again', 'branding twice replaces the version resource');
  assert.deepEqual(versionParts('1.2'), [1, 2, 0, 0]);
  assert.throws(() => versionParts('1.70000'), /does not fit/);
  assert.equal(withDpiAwareness(withDpiAwareness('<a><windowsSettings></windowsSettings></a>')).match(/dpiAwareness/g).length, 2);
});

test('--include: specs, globs, folders, conflicts', async (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, { 'data/a.json': '{}', 'data/sub/b.json': '{}', 'img/x.png': 'p', 'img/y.png': 'p', 'img/z.txt': 't', 'readme.md': 'r', 'other/a.json': '[]' });
  assert.deepEqual(parseSpec('data=assets/'), { src: 'data', dest: 'assets' });
  assert.deepEqual(parseSpec('readme.md=.'), { src: 'readme.md', dest: '' });
  assert.throws(() => parseSpec('data=../x'), /relative folder/);
  assert.throws(() => parseSpec('data'), /SRC=DEST/);
  assert.ok(globToRegExp('**/*.json').test('a/b/c.json') && globToRegExp('**/*.json').test('c.json') && !globToRegExp('*.json').test('a/c.json'));
  const files = await resolveIncludes(['data=data', 'img/*.png=icons', 'readme.md=.'], dir);
  assert.deepEqual(files.map((f) => f.to), ['data/a.json', 'data/sub/b.json', 'icons/x.png', 'icons/y.png', 'readme.md']);
  await assert.rejects(resolveIncludes(['img/*.gif=x'], dir), /no files match/);
  await assert.rejects(resolveIncludes(['missing=x'], dir), /does not exist/);
  await assert.rejects(resolveIncludes(['data/a.json=d', 'other/a.json=d'], dir), /d\/a\.json is already provided/);
});

/** Minimal zip reader for the test: entries with name, Unix mode and content. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let off = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(off + 10);
    const size = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const mode = buf.readUInt32LE(off + 38) >>> 16;
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const data = buf.subarray(local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28) + size);
    out.push({ name, mode, data: method === 8 ? zlib.inflateRawSync(data) : data });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('zip keeps Unix modes, UTF-8 names and is deterministic', async (t) => {
  const dir = tmpdir(t);
  writeFiles(dir, { 'My Äpp.app/Contents/MacOS/My App': 'launcher', 'My Äpp.app/Contents/Resources/data ✓.txt': 'x'.repeat(1000) });
  const opts = { date: new Date(Date.UTC(2024, 0, 1)), modeOf: (rel, type) => (type === 'dir' || rel.startsWith('Contents/MacOS/') ? 0o755 : 0o644) };
  const a = await zipDirectory(path.join(dir, 'My Äpp.app'), path.join(dir, 'a.zip'), opts);
  const b = await zipDirectory(path.join(dir, 'My Äpp.app'), path.join(dir, 'b.zip'), opts);
  assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)));
  const entries = readZip(fs.readFileSync(a));
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  assert.equal(byName['My Äpp.app/Contents/MacOS/My App'].mode, 0o100755);
  assert.equal(byName['My Äpp.app/Contents/Resources/data ✓.txt'].mode, 0o100644);
  assert.equal(byName['My Äpp.app/Contents/Resources/data ✓.txt'].data.toString(), 'x'.repeat(1000));
  assert.equal(byName['My Äpp.app/'].mode, 0o040755);
});

test('--sign-cmd: quoting, {file} placement, failures', async (t) => {
  assert.equal(expand('sign {file} --flag', "/tmp/it's here/a.exe", 'linux'), "sign '/tmp/it'\\''s here/a.exe' --flag");
  assert.equal(expand('signtool sign /a', 'C:\\A B\\x.exe', 'win32'), 'signtool sign /a "C:\\A B\\x.exe"');
  const dir = tmpdir(t);
  const exe = path.join(dir, 'Çay App.exe');
  fs.writeFileSync(exe, 'MZ');
  const signer = path.join(dir, 'signer.js');
  fs.writeFileSync(signer, "const f = process.argv[2]; if (!f.endsWith('.exe')) process.exit(3); require('fs').appendFileSync(f, '+signed');");
  await signFile(`"${process.execPath}" "${signer}" {file}`, exe);
  assert.equal(fs.readFileSync(exe, 'utf8'), 'MZ+signed');
  fs.writeFileSync(path.join(dir, 'fail.js'), "console.error('certificate not found'); process.exit(4);");
  await assert.rejects(signFile(`"${process.execPath}" "${path.join(dir, 'fail.js')}"`, exe), /exit code 4:\ncertificate not found/);
});
