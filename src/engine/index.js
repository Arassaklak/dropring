'use strict';
// DropRing dönüşüm motoru — arayüzden bağımsız. Uygulama, CLI ve testler aynı kodu kullanır.
//
//   const engine = new Engine({ renderer, dataDir });
//   await engine.run({ files, target: 'webp', opts: { quality: 80 } }, onEvent)
//   await engine.run({ files, recipe: { steps: [...] } }, onEvent)
//   await engine.run({ files, action: 'merge-pdf' }, onEvent)

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const formats = require('./formats');
const { Planner } = require('./planner');
const output = require('./output');
const recipes = require('./recipes');

const CONVERTERS = [
  ...require('./converters/image'),
  ...require('./converters/media'),
  ...require('./converters/document'),
  ...require('./converters/data'),
  ...require('./converters/archive'),
  ...require('./converters/platform'),
];

/** Çok dosyalı / özel işlemler (formata bağlı olmayan dilimler). */
const ACTIONS = {
  'merge-pdf': { label: 'PDF birleştir', icon: '⧉', multi: true, accepts: (ids) => ids.length > 1 && ids.every((i) => i === 'pdf' || ['jpg', 'png', 'webp', 'avif', 'tiff', 'gif', 'svg'].includes(i)) },
  'zip-all': { label: 'ZIP yap', icon: '🗜', multi: true, accepts: (ids, all) => all.length > 0 },
  'extract': { label: 'Arşivi aç', icon: '📂', accepts: (ids) => ids.length > 0 && ids.every((i) => ['zip', 'tar', 'tgz'].includes(i)) },
  'split-pdf': { label: 'Sayfalara böl', icon: '✂', accepts: (ids) => ids.length > 0 && ids.every((i) => i === 'pdf') },
  'frames': { label: 'Karelere ayır', icon: '🎞', accepts: (ids) => ids.length > 0 && ids.every((i) => formats.category(i) === 'video') },
  'strip': { label: 'Gizlilik temizliği', icon: '🛡', accepts: (ids) => ids.length > 0 && ids.every((i) => ['jpg', 'png', 'webp', 'avif', 'tiff', 'mp4', 'mov', 'mp3', 'm4a', 'pdf'].includes(i)) },
};

class Engine {
  constructor({ renderer = null, dataDir = path.join(os.homedir(), '.dropring'), concurrency } = {}) {
    this.renderer = renderer;
    this.dataDir = dataDir;
    this.concurrency = concurrency || Math.max(1, Math.min(4, os.cpus().length - 1));
    const usable = CONVERTERS.filter((c) => !c.needsRenderer || renderer);
    this.planner = new Planner(usable);
    this.workRoot = path.join(os.tmpdir(), `dropring-${process.pid}`);
  }

  setRenderer(r) { this.renderer = r; this.planner = new Planner(CONVERTERS.filter((c) => !c.needsRenderer || r)); }

  /** Sürüklenen dosyalar için halkada gösterilecek hedefler ve işlemler. */
  options(filesOrIds) {
    const ids = filesOrIds.map((f) => (formats.get(f) ? f : formats.detect(f)));
    const known = ids.filter(Boolean);
    let targets = [];
    if (known.length && known.length === ids.length) {
      const sets = [...new Set(known)].map((id) => new Map(this.planner.targets(id).map((t) => [t.id, t])));
      const first = sets[0];
      for (const [id, t] of first) if (sets.every((s) => s.has(id))) targets.push({ ...t, label: (formats.get(id) || {}).label || id.toUpperCase(), cat: formats.category(id) });
      // Kaynakla aynı format "sıkıştır / yeniden kodla" demek; listede sona at
      targets.sort((a, b) => (a.same ? 1 : 0) - (b.same ? 1 : 0) || a.cost - b.cost);
    }
    const actions = Object.entries(ACTIONS).filter(([, a]) => a.accepts(known, ids)).map(([id, a]) => ({ id, label: a.label, icon: a.icon }));
    return { formats: ids, targets, actions };
  }

  async _work() {
    const dir = path.join(this.workRoot, crypto.randomBytes(6).toString('hex'));
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  /** Tek dosyayı bir hedefe çevirir; ara adımlar geçici klasörde. Son çıktının yolunu döner. */
  async convertFile(file, to, opts = {}, ctx = {}) {
    const from = formats.detect(file);
    if (!from) throw new Error('Tanınmayan dosya türü');
    let route = this.planner.plan(from, to);
    if (!route) throw new Error(`${from.toUpperCase()} → ${to.toUpperCase()} için yol yok`);
    const work = await this._work();
    try {
      let cur = file;
      for (let i = 0; i < route.length; i++) {
        const step = route[i];
        const last = i === route.length - 1;
        const out = path.join(work, `adim${i}.${formats.ext(step.to)}`);
        // Görsel işlemleri (boyut, kalite, hedef boyut) yalnızca son adımda uygula
        const stepOpts = last ? opts : { quality: 95, dpi: opts.dpi, pages: opts.pages, pageSize: opts.pageSize };
        const sub = (p) => ctx.onProgress && ctx.onProgress((i + p) / route.length);
        const r = await step.conv.run({ input: cur, output: out, from: step.from, to: step.to, opts: stepOpts, ctx: { ...ctx, renderer: this.renderer, onProgress: sub } });
        cur = (r && r.outputPath) || out;
      }
      return { temp: cur, work, route: route.map((s) => `${s.from}→${s.to} (${s.conv.name})`) };
    } catch (e) {
      await fs.promises.rm(work, { recursive: true, force: true });
      throw e;
    }
  }

  /**
   * Bir işi çalıştırır. job = { files, target?, opts?, recipe?, action?, output? }.
   * onEvent({ type: 'progress'|'file-done'|'file-error'|'done', ... })
   * Dönüş: { results: [{ input, outputs, error, bytesIn, bytesOut, route }], backups }
   */
  async run(job, onEvent = () => {}, signal) {
    const files = job.files.filter((f) => fs.existsSync(f));
    const outCfg = { ...output.DEFAULTS, ...(job.output || {}) };
    const results = [];
    const progress = new Map(files.map((f) => [f, 0]));
    const emit = () => onEvent({ type: 'progress', value: [...progress.values()].reduce((a, b) => a + b, 0) / Math.max(1, files.length) });

    // Çok dosyalı işlemler
    if (job.action && ACTIONS[job.action] && ACTIONS[job.action].multi) {
      const r = await this._multi(job.action, files, outCfg, job.opts || {});
      results.push(r);
      onEvent({ type: 'done', results });
      return { results };
    }

    // Tarif: aşamalara derle
    const stages = job.recipe ? recipes.compile(job.recipe) : job.action ? [{ action: job.action, opts: job.opts || {} }] : [{ to: job.target, opts: job.opts || {} }];
    const recipeOut = job.recipe ? recipes.outputOf(job.recipe) : {};
    Object.assign(outCfg, recipeOut);

    let idx = 0;
    const worker = async () => {
      while (idx < files.length) {
        if (signal && signal.aborted) return;
        const file = files[idx++];
        const res = { input: file, outputs: [], bytesIn: (await fs.promises.stat(file)).size };
        try {
          let cur = file, temps = [], route = [];
          for (let s = 0; s < stages.length; s++) {
            const st = stages[s];
            const onProgress = (p) => { progress.set(file, (s + p) / stages.length); emit(); };
            if (st.action) { const r = await this._single(st.action, cur, st.opts, outCfg, { onProgress, signal }); res.outputs.push(...r); route.push(st.action); cur = null; break; }
            const to = st.to === 'same' ? formats.detect(cur) : st.to;
            const r = await this.convertFile(cur, to, st.opts, { onProgress, signal });
            temps.push(r.work); route.push(...r.route); cur = r.temp;
          }
          if (cur) {
            const dest = await output.resolve(file, cur, outCfg, { index: results.length + 1 });
            if (dest) {
              await output.place(cur, dest);
              res.outputs.push(dest);
            } else res.skipped = true;
          }
          for (const t of temps) await fs.promises.rm(t, { recursive: true, force: true });
          if (outCfg.replaceOriginal && res.outputs.length && !res.outputs.includes(file)) res.backup = await output.backup(file, this.dataDir);
          res.bytesOut = await output.sizeOf(res.outputs);
          res.route = route;
          progress.set(file, 1); emit();
          onEvent({ type: 'file-done', result: res });
        } catch (e) {
          res.error = e.message || String(e);
          progress.set(file, 1); emit();
          onEvent({ type: 'file-error', result: res });
        }
        results.push(res);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, files.length) }, worker));
    onEvent({ type: 'done', results });
    return { results };
  }

  async _single(action, file, opts, outCfg, ctx) {
    const base = path.basename(file).replace(/\.[^.]+$/, '').replace(/\.tar$/, '');
    const dir = output.folderFor(file, outCfg);
    await fs.promises.mkdir(dir, { recursive: true });
    if (action === 'extract') {
      const dest = output.unique(path.join(dir, base));
      await require('./converters/archive').extract(file, dest);
      return [dest];
    }
    if (action === 'split-pdf') {
      const dest = output.unique(path.join(dir, `${base} (sayfalar)`));
      await require('./converters/document').splitPdf(file, dest);
      return [dest];
    }
    if (action === 'frames') {
      const dest = output.unique(path.join(dir, `${base} (kareler)`));
      const r = await require('./converters/media').frames({ input: file, output: dest + '.png', opts: opts || {}, ctx });
      return [r.outputPath];
    }
    if (action === 'strip') {
      const r = await this.convertFile(file, formats.detect(file), { ...opts, strip: true, quality: opts.quality || 92 }, ctx);
      const dest = await output.resolve(file, r.temp, { ...outCfg, pattern: outCfg.pattern === '{name}' ? '{name}-temiz' : outCfg.pattern });
      await output.place(r.temp, dest);
      await fs.promises.rm(r.work, { recursive: true, force: true });
      return [dest];
    }
    throw new Error(`Bilinmeyen işlem: ${action}`);
  }

  async _multi(action, files, outCfg, opts) {
    const dir = output.folderFor(files[0], outCfg);
    await fs.promises.mkdir(dir, { recursive: true });
    const bytesIn = (await Promise.all(files.map((f) => fs.promises.stat(f).then((s) => s.size)))).reduce((a, b) => a + b, 0);
    const res = { input: files.length > 1 ? `${files.length} dosya` : files[0], inputs: files, outputs: [], bytesIn };
    try {
      const first = path.basename(files[0]).replace(/\.[^.]+$/, '');
      if (action === 'merge-pdf') {
        const dest = output.unique(path.join(dir, `${first} (birleşik).pdf`));
        await require('./converters/document').mergeToPdf(files, dest, opts);
        res.outputs.push(dest);
      } else if (action === 'zip-all') {
        const name = files.length === 1 ? first : path.basename(dir) || 'arsiv';
        const dest = output.unique(path.join(dir, `${name}.zip`));
        await require('./converters/archive').pack(files, dest, 'zip');
        res.outputs.push(dest);
      }
      res.bytesOut = await output.sizeOf(res.outputs);
    } catch (e) { res.error = e.message; }
    return res;
  }

  /** Geri al: çıktıları çöpe at (ya da sil), yedeklenen orijinali geri koy. */
  async undo(entry, trash = (p) => fs.promises.rm(p, { recursive: true, force: true })) {
    for (const r of entry.results || []) {
      for (const o of r.outputs || []) if (fs.existsSync(o)) await trash(o);
      if (r.backup && fs.existsSync(r.backup) && !fs.existsSync(r.input)) await fs.promises.rename(r.backup, r.input).catch(() => fs.promises.copyFile(r.backup, r.input));
    }
  }

  async cleanup() { await fs.promises.rm(this.workRoot, { recursive: true, force: true }); }
}

module.exports = { Engine, ACTIONS, CONVERTERS, formats, recipes, output };
