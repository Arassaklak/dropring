'use strict';
// Belge ve PDF motoru.
// Word → HTML (mammoth), Markdown → HTML (marked), HTML → PDF (Chromium'un kendi yazdırma motoru),
// PDF → görsel (pdf.js, Chromium içinde), PDF birleştirme / bölme / sayfa seçme (pdf-lib).

const fs = require('fs');
const path = require('path');
const { PDFDocument, degrees } = require('pdf-lib');

const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif; font-size: 11pt; line-height: 1.55; color: #1b1b1f; }
  h1,h2,h3,h4 { line-height: 1.25; margin: 1.2em 0 .5em; } h1 { font-size: 22pt; } h2 { font-size: 16pt; }
  img { max-width: 100%; } table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  td, th { border: 1px solid #c9c9d1; padding: 4px 8px; vertical-align: top; } th { background: #f2f2f6; }
  pre, code { font-family: "SF Mono", Consolas, Menlo, monospace; font-size: 9.5pt; }
  pre { background: #f5f5f8; padding: 10px 12px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
  blockquote { border-left: 3px solid #c9c9d1; margin: 0; padding-left: 12px; color: #555; }
`;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const page = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;

async function readText(file) {
  const buf = await fs.promises.readFile(file);
  // UTF-8 BOM / UTF-16 tespiti; değilse UTF-8, bozuksa Windows-1254 (Türkçe) dene
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1254').decode(buf); }
}

async function toHtml({ input, output, from }) {
  const title = path.basename(input).replace(/\.[^.]+$/, '');
  let body;
  if (from === 'docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.convertToHtml({ path: input }, {
      convertImage: mammoth.images.dataUri,
      styleMap: ["p[style-name='Title'] => h1.title:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Başlık'] => h1:fresh", "p[style-name='Alt Başlık'] => h2:fresh"],
    });
    body = r.value;
  } else if (from === 'md') {
    const { marked } = require('marked');
    body = marked.parse(await readText(input), { gfm: true });
  } else if (from === 'txt') {
    body = `<pre style="background:none;padding:0;font-size:10.5pt">${esc(await readText(input))}</pre>`;
  } else throw new Error(`HTML'e çevrilemez: ${from}`);
  await fs.promises.writeFile(output, page(title, body), 'utf8');
}

async function toText({ input, output, from, ctx }) {
  let text;
  if (from === 'docx') text = (await require('mammoth').extractRawText({ path: input })).value;
  else if (from === 'html') text = (await readText(input)).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
  else if (from === 'md') text = await readText(input);
  else if (from === 'pdf') text = await pdfText(input);
  await fs.promises.writeFile(output, text, 'utf8');
}

async function toMarkdown({ input, output, from }) {
  if (from === 'docx') {
    const r = await require('mammoth').convertToMarkdown({ path: input });
    await fs.promises.writeFile(output, r.value, 'utf8');
  } else if (from === 'html') {
    // Basit HTML → Markdown
    let h = await readText(input);
    h = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n${'#'.repeat(n)} ${t}\n`)
      .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)').replace(/<li[^>]*>/gi, '- ')
      .replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n');
    await fs.promises.writeFile(output, h.trim() + '\n', 'utf8');
  }
}

async function htmlToPdf({ input, output, ctx, opts }) {
  if (!ctx.renderer) throw new Error('PDF oluşturmak için uygulama penceresi gerekir (CLI\'yi uygulama ile çalıştırın).');
  await ctx.renderer.htmlToPdf(input, output, { pageSize: opts.pageSize || 'A4', landscape: !!opts.landscape });
}

async function pdfText(input) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.promises.readFile(input));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const c = await p.getTextContent();
    let line = '', lastY = null;
    const lines = [];
    for (const it of c.items) {
      const y = it.transform ? Math.round(it.transform[5]) : null;
      if (lastY !== null && y !== lastY) { lines.push(line); line = ''; }
      line += it.str; lastY = y;
      if (it.hasEOL) { lines.push(line); line = ''; lastY = null; }
    }
    if (line) lines.push(line);
    out.push(lines.join('\n'));
  }
  await doc.destroy();
  return out.join('\n\n\f');
}

async function pdfToImage({ input, output, to, opts, ctx }) {
  if (!ctx.renderer) throw new Error('PDF sayfalarını çizmek için uygulama penceresi gerekir.');
  const pages = await ctx.renderer.pdfToImages(input, { dpi: opts.dpi || 150, format: to, pages: opts.pages, quality: opts.quality || 90, onProgress: ctx.onProgress });
  if (pages.length === 1) { await fs.promises.writeFile(output, pages[0].data); return; }
  const dir = output.replace(/\.[^.]+$/, '');
  await fs.promises.mkdir(dir, { recursive: true });
  for (const p of pages) await fs.promises.writeFile(path.join(dir, `sayfa_${String(p.n).padStart(3, '0')}.${to}`), p.data);
  return { outputPath: dir };
}

/** "1-3,5,8-" → [0,1,2,4,7,...] (0 tabanlı) */
function parseRange(spec, count) {
  if (!spec) return [...Array(count).keys()];
  const set = new Set();
  for (const part of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : count;
      for (let i = a; i <= Math.min(b, count); i++) set.add(i - 1);
    } else if (+part >= 1 && +part <= count) set.add(+part - 1);
  }
  return [...set].sort((x, y) => x - y);
}

async function imageToPdf({ input, output, from, opts }) {
  const sharp = require('sharp');
  const doc = await PDFDocument.create();
  await addImagePage(doc, input, from, opts, sharp);
  await fs.promises.writeFile(output, await doc.save());
}

async function addImagePage(doc, input, from, opts, sharp) {
  let bytes, kind;
  if (from === 'jpg') { bytes = await fs.promises.readFile(input); kind = 'jpg'; }
  else if (from === 'png') { bytes = await fs.promises.readFile(input); kind = 'png'; }
  else { bytes = await sharp(input).rotate().jpeg({ quality: opts.quality || 92 }).toBuffer(); kind = 'jpg'; }
  if (kind === 'jpg' && from === 'jpg') bytes = await sharp(bytes).rotate().jpeg({ quality: opts.quality || 92 }).toBuffer();
  const img = kind === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  if (opts.pageSize === 'A4') {
    const [W, H] = img.width > img.height ? [842, 595] : [595, 842];
    const s = Math.min((W - 40) / img.width, (H - 40) / img.height, 1);
    const p = doc.addPage([W, H]);
    p.drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s });
  } else {
    const p = doc.addPage([img.width * 0.75, img.height * 0.75]); // 96 dpi → pt
    p.drawImage(img, { x: 0, y: 0, width: img.width * 0.75, height: img.height * 0.75 });
  }
}

/** PDF → PDF: sayfa aralığı seçme ve döndürme (ör. "2-5" ya da "tek sayfalar"). */
async function pdfToPdf({ input, output, opts }) {
  const src = await PDFDocument.load(await fs.promises.readFile(input), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const idx = parseRange(opts.pages, src.getPageCount());
  const copied = await out.copyPages(src, idx);
  for (const p of copied) { if (opts.rotate) p.setRotation(degrees((p.getRotation().angle + Number(opts.rotate)) % 360)); out.addPage(p); }
  await fs.promises.writeFile(output, await out.save({ useObjectStreams: true }));
}

// ——— Çok dosyalı işlemler (tek çıktı) ———

async function mergeToPdf(files, output, opts = {}) {
  const sharp = require('sharp');
  const formats = require('../formats');
  const out = await PDFDocument.create();
  for (const f of files) {
    const id = formats.detect(f);
    if (id === 'pdf') {
      const src = await PDFDocument.load(await fs.promises.readFile(f), { ignoreEncryption: true });
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
    } else if (formats.category(id) === 'image') {
      await addImagePage(out, f, id, opts, sharp);
    } else throw new Error(`PDF'e eklenemez: ${path.basename(f)}`);
  }
  await fs.promises.writeFile(output, await out.save({ useObjectStreams: true }));
}

async function splitPdf(input, outDir) {
  const src = await PDFDocument.load(await fs.promises.readFile(input), { ignoreEncryption: true });
  await fs.promises.mkdir(outDir, { recursive: true });
  const base = path.basename(input, path.extname(input));
  for (const i of src.getPageIndices()) {
    const d = await PDFDocument.create();
    const [p] = await d.copyPages(src, [i]);
    d.addPage(p);
    await fs.promises.writeFile(path.join(outDir, `${base}_s${String(i + 1).padStart(3, '0')}.pdf`), await d.save());
  }
  return outDir;
}

module.exports = [
  { id: 'to-html', name: 'HTML oluşturucu', edges: [[['docx', 'md', 'txt'], ['html'], 10]], run: toHtml },
  { id: 'to-text', name: 'Metin çıkarıcı', edges: [[['docx', 'html', 'md', 'pdf'], ['txt'], 10]], run: toText },
  { id: 'to-md', name: 'Markdown', edges: [[['docx', 'html'], ['md'], 12]], run: toMarkdown },
  { id: 'chromium-pdf', name: 'Chromium PDF', edges: [[['html'], ['pdf'], 10]], run: htmlToPdf, needsRenderer: true },
  { id: 'pdfjs', name: 'PDF çizici (pdf.js)', edges: [[['pdf'], ['png', 'jpg', 'webp'], 10]], run: pdfToImage, needsRenderer: true },
  { id: 'pdf-lib', name: 'PDF araçları', edges: [[['pdf'], ['pdf'], 5], [['jpg', 'png', 'webp', 'avif', 'tiff', 'gif', 'svg'], ['pdf'], 10, { terminal: true }]], run: (a) => (a.from === 'pdf' ? pdfToPdf(a) : imageToPdf(a)) },
];
module.exports.mergeToPdf = mergeToPdf;
module.exports.splitPdf = splitPdf;
module.exports.parseRange = parseRange;
module.exports.PRINT_CSS = PRINT_CSS;
