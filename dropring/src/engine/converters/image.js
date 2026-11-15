'use strict';
// Görsel motoru: sharp (libvips). Yeniden boyutlandırma, kalite, gri ton, döndürme,
// meta veri temizliği ve hedef dosya boyutu burada.

const fs = require('fs');
const sharp = require('sharp');

sharp.cache(false);

const READ = ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'svg'];
const WRITE = ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff'];

/** sharp ardışık düzenini seçeneklere göre kurar (format hariç). */
function pipeline(input, opts = {}) {
  const animated = opts.animated !== false;
  let img = sharp(input, { animated, limitInputPixels: false, density: opts.dpi || 144 });
  img = img.rotate(); // EXIF yönünü uygula
  if (opts.rotate) img = img.rotate(Number(opts.rotate));
  if (opts.flip) img = img.flip();
  if (opts.flop) img = img.flop();
  if (opts.maxWidth || opts.maxHeight) {
    img = img.resize({
      width: opts.maxWidth ? Number(opts.maxWidth) : null,
      height: opts.maxHeight ? Number(opts.maxHeight) : null,
      fit: opts.fit || 'inside',
      withoutEnlargement: true,
    });
  }
  if (opts.crop) img = img.extract(opts.crop);
  if (opts.grayscale) img = img.grayscale();
  if (!opts.strip) img = img.keepMetadata(); else img = img.keepIccProfile();
  return img;
}

function encode(img, to, quality, opts = {}) {
  const q = Math.max(1, Math.min(100, Math.round(quality ?? 85)));
  switch (to) {
    case 'jpg': return img.flatten({ background: opts.background || '#ffffff' }).jpeg({ quality: q, mozjpeg: true, progressive: true });
    case 'png': return img.png({ compressionLevel: 9, palette: q < 90, quality: q, effort: 7 });
    case 'webp': return img.webp({ quality: q, effort: 5, lossless: !!opts.lossless });
    case 'avif': return img.avif({ quality: Math.max(1, q - 15), effort: 4, lossless: !!opts.lossless });
    case 'gif': return img.gif({ effort: 7 });
    case 'tiff': return img.tiff({ compression: 'lzw' });
    default: throw new Error(`Desteklenmeyen hedef: ${to}`);
  }
}

/** Hedef boyutun altına inen en yüksek kaliteyi ikili aramayla bulur; gerekirse küçültür. */
async function encodeToTarget(input, to, opts) {
  const target = Number(opts.targetBytes);
  const lossy = ['jpg', 'webp', 'avif'].includes(to);
  let scale = 1;
  const meta = await sharp(input, { animated: false }).metadata();
  let best = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = meta.width ? Math.round(meta.width * scale) : null;
    const o = { ...opts, animated: false };
    if (scale < 1 && w) { o.maxWidth = Math.min(w, o.maxWidth || Infinity); }
    if (!lossy) {
      const buf = await encode(pipeline(input, o), to, 80, o).toBuffer();
      if (buf.length <= target) return buf;
      best = buf;
    } else {
      let lo = 20, hi = 95, found = null;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const buf = await encode(pipeline(input, o), to, mid, o).toBuffer();
        if (buf.length <= target) { found = buf; lo = mid + 1; } else { hi = mid - 1; best = best && best.length < buf.length ? best : buf; }
      }
      if (found) return found;
    }
    scale *= 0.75;
  }
  return best; // ulaşılamadıysa en küçük sonuç
}

async function run({ input, output, to, opts }) {
  if (opts.targetBytes && to !== 'gif') {
    const buf = await encodeToTarget(input, to, opts);
    await fs.promises.writeFile(output, buf);
    return;
  }
  const animated = to === 'gif' || to === 'webp';
  const img = pipeline(input, { ...opts, animated });
  await encode(img, to, opts.quality, opts).toFile(output);
}

// ICO: 16–256 piksel PNG'leri tek dosyada paketler (Vista+ PNG gömülü ICO).
async function toIco(input, output, opts) {
  const sizes = opts.icoSizes || [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    pngs.push(await sharp(input).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((png, i) => {
    const s = sizes[i];
    const e = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, e); dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
    dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(png.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  await fs.promises.writeFile(output, Buffer.concat([header, dir, ...pngs]));
}

module.exports = [
  {
    id: 'sharp',
    name: 'Görsel (libvips)',
    edges: [[READ, WRITE, 10]],
    run,
  },
  {
    id: 'ico',
    name: 'Simge (ICO)',
    edges: [[['png', 'jpg', 'webp', 'svg', 'avif', 'tiff', 'gif'], ['ico'], 10]],
    run: ({ input, output, opts }) => toIco(input, output, opts),
  },
];
module.exports.pipeline = pipeline;
module.exports.encode = encode;
