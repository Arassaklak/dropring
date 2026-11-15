'use strict';
// Arşiv motoru: ZIP (adm-zip), TAR / TAR.GZ (tar). Açma, paketleme ve arşivler arası dönüşüm.

const fs = require('fs');
const os = require('os');
const path = require('path');

async function extract(input, outDir) {
  const formats = require('../formats');
  const id = formats.detect(input);
  await fs.promises.mkdir(outDir, { recursive: true });
  if (id === 'zip') {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(input);
    // Zip-slip koruması: çıktı klasörünün dışına yazan girdileri atla
    for (const e of zip.getEntries()) {
      const target = path.resolve(outDir, e.entryName);
      if (!target.startsWith(path.resolve(outDir) + path.sep) && target !== path.resolve(outDir)) continue;
      if (e.isDirectory) { await fs.promises.mkdir(target, { recursive: true }); continue; }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, e.getData());
    }
  } else if (id === 'tar' || id === 'tgz') {
    await require('tar').x({ file: input, cwd: outDir, strict: false, preservePaths: false });
  } else throw new Error('Desteklenmeyen arşiv');
  return outDir;
}

async function pack(files, output, kind = 'zip') {
  if (kind === 'zip') {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    for (const f of files) {
      const st = await fs.promises.stat(f);
      if (st.isDirectory()) zip.addLocalFolder(f, path.basename(f)); else zip.addLocalFile(f);
    }
    await new Promise((res, rej) => zip.writeZip(output, (err) => (err ? rej(err) : res())));
  } else {
    // tar: dosyaları ortak bir üst klasöre göre ekle
    const cwd = path.dirname(files[0]);
    const rel = files.map((f) => path.relative(cwd, f));
    await require('tar').c({ gzip: kind === 'tgz', file: output, cwd, portable: true }, rel);
  }
  return output;
}

async function convert({ input, output, to }) {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dropring-arc-'));
  try {
    await extract(input, tmp);
    const entries = (await fs.promises.readdir(tmp)).map((n) => path.join(tmp, n));
    if (to === 'zip') await pack(entries, output, 'zip');
    else await require('tar').c({ gzip: to === 'tgz', file: output, cwd: tmp, portable: true }, await fs.promises.readdir(tmp));
  } finally { await fs.promises.rm(tmp, { recursive: true, force: true }); }
}

module.exports = [
  { id: 'archive', name: 'Arşiv', edges: [[['zip', 'tar', 'tgz'], ['zip', 'tgz', 'tar'], 10]], run: convert },
];
module.exports.extract = extract;
module.exports.pack = pack;
