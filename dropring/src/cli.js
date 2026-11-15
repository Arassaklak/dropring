#!/usr/bin/env node
'use strict';
// DropRing komut satırı. Uygulamayla aynı motor, tarifler ve ayarlar.
//   dropring convert foto.heic --to jpg
//   dropring convert *.png --to webp --quality 80 --max 1920 -o cikti
//   dropring convert video.mov --to mp4 --target 15MB
//   dropring recipe "Web için" *.jpg
//   dropring action merge-pdf a.pdf b.pdf tarama.jpg
//   dropring watch ~/Downloads --to jpg --move-originals
//   dropring formats foto.png

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function userDataDir() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'DropRing');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'DropRing');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'DropRing');
}

const HELP = `DropRing — sürükle-bırak dosya dönüştürücü (komut satırı)

Kullanım:
  dropring convert <dosyalar...> --to <format> [seçenekler]
  dropring recipe "<tarif adı>" <dosyalar...>
  dropring action <işlem> <dosyalar...>      merge-pdf | zip-all | extract | split-pdf | frames | strip
  dropring watch <klasör> --to <format> | --recipe "<ad>" [--move-originals]
  dropring formats [dosya]                   desteklenen formatlar ya da bir dosyanın hedefleri
  dropring recipes                           tarifleri listele

Seçenekler:
  --to <fmt>           hedef format (jpg, webp, pdf, mp4, mp3, xlsx, ...)
  -q, --quality <1-100>
  --max <px>           en uzun kenar sınırı (görsel/video)
  --target <boyut>     hedef dosya boyutu, ör. 900KB, 15MB (görsel/video/ses)
  --strip              EXIF/GPS dahil meta verileri sil
  --gray               gri tonlama
  --pages <aralık>     PDF sayfaları, ör. 1-3,5
  --dpi <n>            PDF → görsel çözünürlüğü
  --start/--end <t>    video/ses kırpma (sn ya da 00:01:20)
  --fps <n>            kare hızı
  --mute               sesi kaldır
  -o, --out <klasör>   çıktı klasörü (varsayılan: orijinalin yanı)
  --pattern <desen>    çıktı adı, ör. "{name}-{w}x{h}"
  --overwrite | --skip ad çakışmasında
  --replace            orijinali yedeğe kaldır
  -j, --jobs <n>       aynı anda iş sayısı
  --json               sonuçları JSON yaz`;

function parse(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const val = () => argv[++i];
    switch (x) {
      case '--to': a.to = val(); break;
      case '-q': case '--quality': a.quality = Number(val()); break;
      case '--max': a.max = Number(val()); break;
      case '--target': a.target = val(); break;
      case '--strip': a.strip = true; break;
      case '--gray': a.gray = true; break;
      case '--pages': a.pages = val(); break;
      case '--dpi': a.dpi = Number(val()); break;
      case '--start': a.start = val(); break;
      case '--end': a.end = val(); break;
      case '--fps': a.fps = Number(val()); break;
      case '--mute': a.mute = true; break;
      case '-o': case '--out': a.out = val(); break;
      case '--pattern': a.pattern = val(); break;
      case '--overwrite': a.conflict = 'overwrite'; break;
      case '--skip': a.conflict = 'skip'; break;
      case '--replace': a.replace = true; break;
      case '--recipe': a.recipe = val(); break;
      case '--move-originals': a.move = true; break;
      case '-j': case '--jobs': a.jobs = Number(val()); break;
      case '--json': a.json = true; break;
      case '-h': case '--help': a.help = true; break;
      default: a._.push(x);
    }
  }
  return a;
}

/** Kabuk joker karakterleri açmazsa (Windows cmd) *.png gibi kalıpları burada aç. */
function expand(list) {
  const out = [];
  for (const p of list) {
    if (!/[*?]/.test(p)) { out.push(path.resolve(p)); continue; }
    const dir = path.dirname(path.resolve(p));
    const re = new RegExp('^' + path.basename(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (re.test(n)) out.push(path.join(dir, n));
  }
  return out.filter((f) => fs.existsSync(f));
}

function loadRecipes() {
  try { return JSON.parse(fs.readFileSync(path.join(userDataDir(), 'veri', 'tarifler.json'), 'utf8')); } catch { return require('./engine/recipes').BUILTIN; }
}
function loadOutput() {
  try { return JSON.parse(fs.readFileSync(path.join(userDataDir(), 'veri', 'ayarlar.json'), 'utf8')).output || {}; } catch { return {}; }
}

function buildJob(a, files) {
  const { recipes } = require('./engine');
  const opts = {};
  if (a.quality) opts.quality = a.quality;
  if (a.max) { opts.maxWidth = a.max; opts.maxHeight = a.max; }
  if (a.target) opts.targetBytes = recipes.parseSize(a.target);
  if (a.strip) opts.strip = true;
  if (a.gray) opts.grayscale = true;
  if (a.pages) opts.pages = a.pages;
  if (a.dpi) opts.dpi = a.dpi;
  if (a.start) opts.start = a.start;
  if (a.end) opts.end = a.end;
  if (a.fps) opts.fps = a.fps;
  if (a.mute) opts.mute = true;
  const output = { ...loadOutput() };
  if (a.out) output.folder = path.resolve(a.out);
  if (a.pattern) output.pattern = a.pattern;
  if (a.conflict) output.conflict = a.conflict;
  if (a.replace) output.replaceOriginal = true;
  return { files, opts, output };
}

const fmtB = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

function report(results, json) {
  if (json) { console.log(JSON.stringify(results, null, 2)); return; }
  let bad = 0;
  for (const r of results) {
    if (r.error) { bad++; console.log(`✗ ${path.basename(String(r.input))}: ${r.error}`); continue; }
    if (r.skipped) { console.log(`– ${path.basename(r.input)}: atlandı (dosya var)`); continue; }
    const d = r.bytesIn && r.bytesOut ? ` (${fmtB(r.bytesIn)} → ${fmtB(r.bytesOut)})` : '';
    console.log(`✓ ${path.basename(String(r.input))} → ${r.outputs.map((o) => { const rel = path.relative(process.cwd(), o); return rel.startsWith('..') ? o : rel; }).join(', ')}${d}`);
  }
  if (bad) process.exitCode = 1;
}

/** HTML→PDF ya da PDF→görsel gibi Chromium gerektiren işler uygulama sürecine devredilir. */
function needsRenderer(job) {
  const { formats } = require('./engine');
  const { Engine } = require('./engine');
  const e = new Engine();
  if (job.target) return job.files.some((f) => !e.planner.plan(formats.detect(f), job.target));
  if (job.recipe) return job.recipe.steps.some((s) => s.op === 'convert' && s.to !== 'same' && job.files.some((f) => !e.planner.plan(formats.detect(f), s.to)));
  return false;
}

function delegate(job) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `dropring-cli-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(job));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const exe = process.execPath;
    const dev = /electron(\.exe)?$/i.test(path.basename(exe));
    if (!process.versions.electron) return reject(new Error('Bu dönüşüm (HTML/Word/Markdown → PDF ya da PDF → görsel) uygulamanın kendisiyle çalışır. "dropring" komutunu kurulumla gelen betikten çalıştırın.'));
    const root = process.platform === 'linux' && process.getuid && process.getuid() === 0;
    const args = [...(dev ? [path.join(__dirname, '..')] : []), ...(root ? ['--no-sandbox'] : []), '--cli-render', tmp];
    const p = spawn(exe, args, { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', reject);
    p.on('close', () => {
      try { const r = JSON.parse(fs.readFileSync(tmp + '.out', 'utf8')); fs.rmSync(tmp + '.out', { force: true }); resolve(r); }
      catch { reject(new Error('Uygulama süreci sonuç döndürmedi. ' + err.split('\n').filter((l) => /error/i.test(l)).slice(-2).join(' '))); }
      fs.rmSync(tmp, { force: true });
    });
  });
}

async function runJob(job, a) {
  const { Engine } = require('./engine');
  if (needsRenderer(job)) { const r = await delegate(job); report(r.results, a.json); return r; }
  const e = new Engine({ dataDir: userDataDir(), concurrency: a.jobs });
  let last = -1;
  const isTTY = process.stderr.isTTY && !a.json;
  const r = await e.run(job, (ev) => {
    if (ev.type === 'progress' && isTTY) { const p = Math.floor(ev.value * 100); if (p !== last) { last = p; process.stderr.write(`\r${p}%  `); } }
  });
  if (isTTY) process.stderr.write('\r     \r');
  await e.cleanup();
  report(r.results, a.json);
  return r;
}

async function main(argv) {
  const a = parse(argv);
  const [cmd, ...rest] = a._;
  const { Engine, formats } = require('./engine');
  if (!cmd || a.help || cmd === 'help') { console.log(HELP); return; }

  if (cmd === 'formats') {
    const e = new Engine();
    if (rest[0]) {
      const o = e.options(expand(rest));
      console.log('Hedefler: ' + o.targets.map((x) => x.id).join(', '));
      console.log('İşlemler: ' + o.actions.map((x) => x.id).join(', '));
      console.log('(PDF/HTML çizimi gereken hedefler uygulamada da var: pdf→png/jpg, docx/md/html→pdf)');
    } else {
      const by = {};
      for (const f of formats.FORMATS) (by[f.cat] = by[f.cat] || []).push(f.label);
      for (const [c, l] of Object.entries(by)) console.log(`${c.padEnd(9)} ${l.join(', ')}`);
    }
    return;
  }
  if (cmd === 'recipes') { for (const r of loadRecipes()) console.log(`${(r.icon || '★')} ${r.name}  [${r.id}]`); return; }

  if (cmd === 'convert') {
    if (!a.to) throw new Error('--to gerekli. Örn: dropring convert foto.png --to webp');
    const files = expand(rest);
    if (!files.length) throw new Error('Dosya bulunamadı.');
    const job = buildJob(a, files); job.target = a.to.toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg');
    return runJob(job, a);
  }
  if (cmd === 'recipe') {
    const name = rest.shift();
    const r = loadRecipes().find((x) => x.id === name || x.name.toLowerCase() === String(name).toLowerCase());
    if (!r) throw new Error(`Tarif bulunamadı: ${name}. "dropring recipes" ile listeleyin.`);
    const job = buildJob(a, expand(rest)); job.recipe = r;
    return runJob(job, a);
  }
  if (cmd === 'action') {
    const id = rest.shift();
    const job = buildJob(a, expand(rest)); job.action = id;
    return runJob(job, a);
  }
  if (cmd === 'watch') {
    const dir = path.resolve(rest[0] || '.');
    const recipe = a.recipe ? loadRecipes().find((x) => x.id === a.recipe || x.name.toLowerCase() === a.recipe.toLowerCase()) : null;
    if (!a.to && !recipe) throw new Error('--to ya da --recipe gerekli.');
    console.log(`İzleniyor: ${dir}  (Ctrl+C ile çık)`);
    const seen = new Set();
    require('chokidar').watch(dir, { ignoreInitial: true, depth: 0, awaitWriteFinish: { stabilityThreshold: 1500 }, ignored: /(^|[\\/])\.|\.(tmp|part|crdownload)$/i })
      .on('add', async (f) => {
        if (seen.has(f)) return;
        const job = buildJob(a, [f]);
        if (!a.out) job.output.folder = path.join(dir, 'Dönüştürülenler');
        if (recipe) job.recipe = recipe; else job.target = a.to;
        const r = await runJob(job, a).catch((e) => console.error('✗', e.message));
        for (const x of (r && r.results) || []) for (const o of x.outputs || []) seen.add(o);
        if (a.move && r && r.results.every((x) => !x.error)) {
          const done = path.join(dir, 'İşlenenler'); fs.mkdirSync(done, { recursive: true });
          fs.renameSync(f, require('./engine/output').unique(path.join(done, path.basename(f))));
        }
      });
    return new Promise(() => {});
  }
  throw new Error(`Bilinmeyen komut: ${cmd}. "dropring help" yazın.`);
}

/** Uygulama sürecinde (Electron) Chromium gerektiren CLI işini çalıştırır. */
function renderEntry() {
  const { app } = require('electron');
  const file = process.argv[process.argv.indexOf('--cli-render') + 1];
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  app.whenReady().then(async () => {
    const { Engine } = require('./engine');
    const e = new Engine({ renderer: require('./main/renderer'), dataDir: userDataDir() });
    let out;
    try { out = await e.run(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (err) { out = { results: [{ input: '?', outputs: [], error: err.message }] }; }
    fs.writeFileSync(file + '.out', JSON.stringify(out));
    await e.cleanup();
    app.exit(0);
  });
  app.on('window-all-closed', (ev) => ev.preventDefault());
}

module.exports = { main, renderEntry, parse };

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { console.error('Hata:', e.message); process.exit(2); });
}
