'use strict';
// Çıktı adlandırma ve yerleştirme. Kaynak dosyanın üzerine ASLA yazılmaz.
// Desen değişkenleri: {name} {ext} {from} {date} {time} {n} {w} {h} {size}

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  folder: 'same',          // 'same' | 'subfolder' | 'downloads' | mutlak yol
  subfolder: 'DropRing',
  pattern: '{name}',
  conflict: 'rename',      // 'rename' | 'overwrite' | 'skip'
  replaceOriginal: false,  // başarıdan sonra orijinali yedeğe taşı (geri alınabilir)
};

function folderFor(source, cfg) {
  const dir = path.dirname(source);
  if (!cfg.folder || cfg.folder === 'same') return dir;
  if (cfg.folder === 'subfolder') return path.join(dir, cfg.subfolder || 'DropRing');
  if (cfg.folder === 'downloads') return path.join(os.homedir(), 'Downloads');
  return cfg.folder.replace(/^~(?=$|[\\/])/, os.homedir());
}

function unique(p) {
  if (!fs.existsSync(p)) return p;
  const isTarGz = /\.tar\.gz$/i.test(p);
  const ext = isTarGz ? '.tar.gz' : path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 1; ; i++) { const c = `${base} (${i})${ext}`; if (!fs.existsSync(c)) return c; }
}

const sanitize = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');

async function tokens(source, temp, ctx) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const t = {
    name: path.basename(source).replace(/\.tar\.gz$/i, '').replace(/\.[^.]+$/, ''),
    from: path.extname(source).slice(1).toLowerCase(),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    n: String(ctx.index || 1).padStart(3, '0'),
    w: '', h: '', size: '',
  };
  try {
    const st = await fs.promises.stat(temp);
    t.size = st.size >= 1048576 ? `${(st.size / 1048576).toFixed(1)}MB` : `${Math.ceil(st.size / 1024)}KB`;
    if (/\.(jpe?g|png|webp|avif|gif|tiff?)$/i.test(temp)) {
      const m = await require('sharp')(temp).metadata();
      t.w = String(m.width || ''); t.h = String(m.height || '');
    }
  } catch { /* isteğe bağlı */ }
  return t;
}

/** Hedef yolu çözer; çakışma 'skip' ise ve dosya varsa null döner. */
async function resolve(source, temp, cfg = DEFAULTS, ctx = {}) {
  const dir = folderFor(source, cfg);
  await fs.promises.mkdir(dir, { recursive: true });
  const isDir = (await fs.promises.stat(temp)).isDirectory();
  const ext = isDir ? '' : /\.tar\.gz$/i.test(temp) ? '.tar.gz' : path.extname(temp);
  const t = await tokens(source, temp, ctx);
  let name = sanitize((cfg.pattern || '{name}').replace(/\{(\w+)\}/g, (m, k) => (k in t ? t[k] : m))) || t.name;
  let dest = path.join(dir, name + ext);
  // Kaynağın kendisi asla hedef olamaz
  if (path.resolve(dest).toLowerCase() === path.resolve(source).toLowerCase()) dest = path.join(dir, `${name}-yeni${ext}`);
  if (fs.existsSync(dest)) {
    if (cfg.conflict === 'skip') return null;
    if (cfg.conflict !== 'overwrite') dest = unique(dest);
  }
  return dest;
}

async function place(temp, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  try { await fs.promises.rename(temp, dest); }
  catch {
    await fs.promises.cp(temp, dest, { recursive: true, force: true });
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
}

/** Orijinali yedek klasörüne taşır (geri al ile geri gelir). */
async function backup(file, dataDir) {
  const dir = path.join(dataDir, 'yedekler', new Date().toISOString().slice(0, 10));
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = unique(path.join(dir, path.basename(file)));
  await place(file, dest);
  return dest;
}

async function sizeOf(paths) {
  let total = 0;
  const walk = async (p) => {
    const st = await fs.promises.stat(p).catch(() => null);
    if (!st) return;
    if (st.isDirectory()) for (const n of await fs.promises.readdir(p)) await walk(path.join(p, n));
    else total += st.size;
  };
  for (const p of paths) await walk(p);
  return total;
}

module.exports = { DEFAULTS, resolve, place, unique, folderFor, backup, sizeOf };
