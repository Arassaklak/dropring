'use strict';
// Motor testleri (arayüzsüz). Çalıştır: node test/engine.test.js <fixtures klasörü>
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Engine, recipes } = require('../src/engine');

const dir = process.argv[2] || '/tmp/t';
const f = (n) => path.join(dir, n);
const out = { folder: path.join(dir, 'cikti'), conflict: 'rename' };
fs.rmSync(out.folder, { recursive: true, force: true }); // her çalıştırmada temiz çıktı klasörü

(async () => {
  const e = new Engine({ dataDir: path.join(dir, '.data') });
  const t0 = Date.now();
  const ok = (name) => console.log('✓', name, `${Date.now() - t0}ms`);

  // Halka seçenekleri
  const o = e.options([f('foto.png')]);
  assert(o.targets.some((t) => t.id === 'webp') && o.targets.some((t) => t.id === 'pdf') && o.targets.some((t) => t.id === 'ico'));
  const mix = e.options([f('foto.png'), f('video.mp4')]);
  assert(!mix.targets.some((t) => t.id === 'webp'), 'karışık seçimde ortak olmayan hedef olmamalı');
  assert(mix.actions.some((a) => a.id === 'zip-all'));
  ok('seçenekler: ' + o.targets.map((t) => t.id).join(','));

  // Rota
  assert.deepStrictEqual(e.planner.plan('json', 'xlsx').map((s) => s.to), ['xlsx']);
  assert(e.planner.plan('bmp', 'webp').length === 2);
  ok('rota bmp→png→webp');

  let r = await e.run({ files: [f('foto.png')], target: 'webp', opts: { quality: 80, maxWidth: 1200 }, output: out });
  assert(!r.results[0].error, r.results[0].error);
  const m = await require('sharp')(r.results[0].outputs[0]).metadata();
  assert.strictEqual(m.width, 1200); assert.strictEqual(m.format, 'webp');
  ok('png→webp 1200px ' + r.results[0].bytesOut);

  // Hedef boyut (görsel)
  r = await e.run({ files: [f('foto.png')], target: 'jpg', opts: { targetBytes: recipes.parseSize('300KB') }, output: out });
  assert(r.results[0].bytesOut <= 300 * 1024, 'hedef boyut aşıldı: ' + r.results[0].bytesOut);
  ok('hedef boyut ≤300KB → ' + r.results[0].bytesOut);

  r = await e.run({ files: [f('foto.png')], target: 'ico', output: out });
  assert(!r.results[0].error, r.results[0].error); ok('ico');

  r = await e.run({ files: [f('foto.png')], target: 'pdf', opts: { pageSize: 'A4' }, output: out });
  assert(!r.results[0].error, r.results[0].error); ok('png→pdf');

  // Video
  r = await e.run({ files: [f('video.mp4')], target: 'webm', opts: { maxWidth: 640 }, output: out });
  assert(!r.results[0].error, r.results[0].error); ok('mp4→webm');
  r = await e.run({ files: [f('video.mp4')], target: 'mp4', opts: { targetBytes: recipes.parseSize('1MB') }, output: out });
  assert(!r.results[0].error && r.results[0].bytesOut <= 1048576 * 1.05, 'video hedef boyut: ' + r.results[0].bytesOut + ' ' + r.results[0].error); ok('video ≤1MB → ' + r.results[0].bytesOut);
  r = await e.run({ files: [f('video.mp4')], target: 'gif', output: out }); assert(!r.results[0].error, r.results[0].error); ok('gif');
  r = await e.run({ files: [f('video.mp4')], target: 'mp3', output: out }); assert(!r.results[0].error, r.results[0].error); ok('mp3');
  r = await e.run({ files: [f('video.mp4')], action: 'frames', opts: { fps: 2 }, output: out }); assert(!r.results[0].error, r.results[0].error);
  assert(fs.readdirSync(r.results[0].outputs[0]).length >= 10); ok('karelere ayır');
  r = await e.run({ files: [f('video.mp4')], target: 'jpg', output: out }); assert(!r.results[0].error, r.results[0].error); ok('video→jpg kare');

  // Veri
  r = await e.run({ files: [f('kisiler.json')], target: 'xlsx', output: out }); assert(!r.results[0].error, r.results[0].error);
  const back = await e.run({ files: [r.results[0].outputs[0]], target: 'csv', output: out });
  const csv = fs.readFileSync(back.results[0].outputs[0], 'utf8');
  assert(csv.includes('adres.il') && csv.includes('İzmir'), csv); ok('json→xlsx→csv (Türkçe)');
  r = await e.run({ files: [f('kisiler.json')], target: 'yaml', output: out }); assert(!r.results[0].error); ok('json→yaml');
  r = await e.run({ files: [f('kisiler.json')], target: 'xml', output: out }); assert(!r.results[0].error); ok('json→xml');

  // Belge (renderer olmadan)
  r = await e.run({ files: [f('not.md')], target: 'html', output: out }); assert(!r.results[0].error, r.results[0].error);
  assert(fs.readFileSync(r.results[0].outputs[0], 'utf8').includes('<table>')); ok('md→html');

  // Tarif
  r = await e.run({ files: [f('foto.png')], recipe: recipes.BUILTIN.find((x) => x.id === 'web'), output: out });
  assert(r.results[0].outputs[0].endsWith('foto-web.webp'), r.results[0].outputs[0] + ' ' + r.results[0].error); ok('tarif: Web için');

  // Çok dosyalı
  r = await e.run({ files: [f('foto.png'), f('not.md')], action: 'zip-all', output: out }); assert(!r.results[0].error); const zip = r.results[0].outputs[0]; ok('zip');
  r = await e.run({ files: [zip], action: 'extract', output: out }); assert(fs.existsSync(path.join(r.results[0].outputs[0], 'not.md'))); ok('zip aç');
  r = await e.run({ files: [zip], target: 'tgz', output: out }); assert(!r.results[0].error, r.results[0].error); ok('zip→tar.gz');
  const pdf1 = (await e.run({ files: [f('foto.png')], target: 'pdf', output: out })).results[0].outputs[0];
  r = await e.run({ files: [pdf1, f('foto.png')], action: 'merge-pdf', output: out }); assert(!r.results[0].error, r.results[0].error);
  const { PDFDocument } = require('pdf-lib');
  assert.strictEqual((await PDFDocument.load(fs.readFileSync(r.results[0].outputs[0]))).getPageCount(), 2); ok('pdf birleştir');
  r = await e.run({ files: [r.results[0].outputs[0]], action: 'split-pdf', output: out }); assert.strictEqual(fs.readdirSync(r.results[0].outputs[0]).length, 2); ok('pdf böl');
  r = await e.run({ files: [pdf1], target: 'txt', output: out }); assert(!r.results[0].error, r.results[0].error); ok('pdf→txt');

  // Geri al + orijinali değiştir
  fs.copyFileSync(f('foto.png'), f('kopya.png'));
  const job = await e.run({ files: [f('kopya.png')], target: 'jpg', output: { ...out, replaceOriginal: true } });
  assert(!fs.existsSync(f('kopya.png')) && fs.existsSync(job.results[0].backup));
  await e.undo(job);
  assert(fs.existsSync(f('kopya.png')) && !fs.existsSync(job.results[0].outputs[0])); ok('geri al');

  // Kaynağın üzerine yazmama
  r = await e.run({ files: [f('foto.png')], target: 'png', opts: { quality: 70 }, output: { folder: 'same' } });
  assert(r.results[0].outputs[0] !== f('foto.png')); fs.rmSync(r.results[0].outputs[0]); ok('kaynak korunur → ' + path.basename(r.results[0].outputs[0]));

  await e.cleanup();
  console.log('\nTüm motor testleri geçti.');
})().catch((err) => { console.error('✗', err); process.exit(1); });
