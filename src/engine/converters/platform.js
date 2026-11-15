'use strict';
// İşletim sisteminin kendi kod çözücüleriyle HEIC/HEIF (iPhone fotoğrafları) okuma.
// macOS: yerleşik `sips`. Windows: WIC (Windows'un "HEIF Görüntü Uzantıları" ile; Windows 11'de çoğunlukla hazır).
// Böylece patentli HEVC kod çözücüsünü uygulamaya gömmek gerekmez.

const { execFile } = require('child_process');

const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { windowsHide: true, timeout: 120000 }, (e, so, se) => (e ? rej(new Error(String(se || e.message).trim())) : res(so))));

const WIC_PS = `
param([string]$in, [string]$out)
Add-Type -AssemblyName PresentationCore
$fs = [IO.File]::OpenRead($in)
try {
  $dec = [Windows.Media.Imaging.BitmapDecoder]::Create($fs, 'PreservePixelFormat', 'OnLoad')
  $enc = New-Object Windows.Media.Imaging.PngBitmapEncoder
  $enc.Frames.Add($dec.Frames[0])
  $o = [IO.File]::Create($out); $enc.Save($o); $o.Close()
} finally { $fs.Close() }`;

const converters = [];

if (process.platform === 'darwin') {
  converters.push({
    id: 'sips', name: 'macOS sips',
    edges: [[['heic'], ['jpg', 'png', 'tiff'], 8]],
    run: ({ input, output, to }) => run('/usr/bin/sips', ['-s', 'format', { jpg: 'jpeg', png: 'png', tiff: 'tiff' }[to], input, '--out', output]),
  });
}

if (process.platform === 'win32') {
  converters.push({
    id: 'wic', name: 'Windows WIC',
    edges: [[['heic'], ['png'], 9]],
    run: async ({ input, output }) => {
      const fs = require('fs'), os = require('os'), path = require('path');
      const ps = path.join(os.tmpdir(), 'dropring-wic.ps1');
      await fs.promises.writeFile(ps, WIC_PS, 'utf8');
      try {
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps, input, output]);
      } catch (e) {
        throw new Error('HEIC okunamadı. Microsoft Store\'dan "HEIF Görüntü Uzantıları"nı kurun. (' + e.message + ')');
      }
    },
  });
}

module.exports = converters;
