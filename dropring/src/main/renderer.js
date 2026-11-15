'use strict';
// Chromium tabanlı yardımcılar: HTML → PDF (Chromium'un yazdırma motoru) ve PDF → görsel (pdf.js).
// Görünmez pencerelerde çalışır; kullanıcı içeriğinde JavaScript kapalıdır.

const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

let pdfWin = null;
let pdfReady = null;

function hidden(extra = {}) {
  return new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { sandbox: true, contextIsolation: true, offscreen: false, ...extra } });
}

async function htmlToPdf(input, output, { pageSize = 'A4', landscape = false } = {}) {
  const win = hidden({ javascript: false });
  try {
    await win.loadFile(input);
    const data = await win.webContents.printToPDF({ pageSize, landscape, printBackground: true, margins: { marginType: 'default' }, generateDocumentOutline: true });
    await fs.promises.writeFile(output, data);
  } finally { win.destroy(); }
}

function ensurePdfWorker() {
  if (pdfWin && !pdfWin.isDestroyed()) return pdfReady;
  pdfWin = hidden({ preload: undefined });
  pdfReady = pdfWin.loadFile(path.join(__dirname, '..', 'worker', 'pdf.html'))
;
  return pdfReady;
}

let lock = Promise.resolve();
/** PDF sayfalarını görsele çizer: [{ n, data: Buffer }]. Tek çizici pencere olduğu için sırayla. */
function pdfToImages(input, opts) {
  const run = lock.then(() => pdfToImagesNow(input, opts));
  lock = run.catch(() => {});
  return run;
}

async function pdfToImagesNow(input, { dpi = 150, format = 'png', pages, quality = 90, onProgress } = {}) {
  await ensurePdfWorker();
  // ES modülü yüklenene kadar bekle
  for (let i = 0; i < 100 && !(await pdfWin.webContents.executeJavaScript('!!window.__ready')); i++) await new Promise((r) => setTimeout(r, 50));
  const b64 = (await fs.promises.readFile(input)).toString('base64');
  const { parseRange } = require('../engine/converters/document');
  const count = await pdfWin.webContents.executeJavaScript(`openPdf(${JSON.stringify(b64)})`);
  const idx = parseRange(pages, count);
  const out = [];
  for (let i = 0; i < idx.length; i++) {
    const dataUrl = await pdfWin.webContents.executeJavaScript(`renderPage(${idx[i] + 1}, ${Number(dpi)}, ${JSON.stringify(format)}, ${Number(quality) / 100})`);
    out.push({ n: idx[i] + 1, data: Buffer.from(dataUrl.split(',')[1], 'base64') });
    if (onProgress) onProgress((i + 1) / idx.length);
  }
  await pdfWin.webContents.executeJavaScript('closePdf()');
  return out;
}

module.exports = { htmlToPdf, pdfToImages };
