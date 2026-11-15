// electron-builder afterPack: hedef platform dışındaki ffprobe ikililerini çıkarır (~100 MB tasarruf).
const fs = require('fs');
const path = require('path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

exports.default = async function (ctx) {
  const plat = ctx.electronPlatformName; // darwin | win32 | linux
  const arch = ARCH[ctx.arch] || 'x64';
  const res = plat === 'darwin'
    ? path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(ctx.appOutDir, 'resources');
  const bin = path.join(res, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin');
  if (!fs.existsSync(bin)) return;
  for (const p of fs.readdirSync(bin)) {
    const pdir = path.join(bin, p);
    if (p !== plat) { fs.rmSync(pdir, { recursive: true, force: true }); continue; }
    for (const a of fs.readdirSync(pdir)) if (a !== arch) fs.rmSync(path.join(pdir, a), { recursive: true, force: true });
  }
  console.log(`  • ffprobe: yalnızca ${plat}/${arch} bırakıldı`);
};
