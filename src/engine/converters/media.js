'use strict';
// Video ve ses motoru: FFmpeg (ffmpeg-static ile birlikte gelir, ayrıca kurulum gerekmez).
// İlerleme FFmpeg'in -progress çıktısından okunur. Hedef boyut için bit hızı hesaplanır.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const VIDEO = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpeg', 'ts', '3gp', 'gif'];
const AUDIO = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma', 'aiff'];
const VIDEO_OUT = ['mp4', 'webm', 'mov', 'mkv', 'gif'];
const AUDIO_OUT = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus'];

function bins() {
  const fix = (p) => p && p.replace('app.asar', 'app.asar.unpacked');
  return { ffmpeg: fix(require('ffmpeg-static')), ffprobe: fix(require('ffprobe-static').path) };
}

function probe(file) {
  return new Promise((resolve) => {
    const p = spawn(bins().ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => {
      try {
        const j = JSON.parse(out);
        const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
        const a = (j.streams || []).find((s) => s.codec_type === 'audio');
        resolve({
          duration: Number(j.format && j.format.duration) || 0,
          width: v ? v.width : 0, height: v ? v.height : 0,
          hasVideo: !!v, hasAudio: !!a,
          fps: v && v.avg_frame_rate ? (([n, d]) => (Number(d) ? Number(n) / Number(d) : 0))(String(v.avg_frame_rate).split('/')) : 0,
        });
      } catch { resolve({ duration: 0, hasVideo: false, hasAudio: false }); }
    });
    p.on('error', () => resolve({ duration: 0 }));
  });
}

function ffmpeg(args, { duration, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bins().ffmpeg, ['-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats', ...args]);
    let err = '';
    const abort = () => p.kill('SIGKILL');
    if (signal) signal.addEventListener('abort', abort, { once: true });
    p.stdout.on('data', (d) => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m && duration && onProgress) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / duration));
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abort);
      if (signal && signal.aborted) return reject(new Error('İptal edildi'));
      code === 0 ? resolve() : reject(new Error(err.split('\n').filter(Boolean).slice(-3).join(' | ') || `FFmpeg ${code}`));
    });
  });
}

function scaleFilter(opts, info) {
  const f = [];
  if (opts.maxWidth || opts.maxHeight) {
    const w = opts.maxWidth || -2, h = opts.maxHeight || -2;
    f.push(`scale='min(${w === -2 ? 'iw' : w},iw)':'min(${h === -2 ? 'ih' : h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
  } else if (info.hasVideo && (info.width % 2 || info.height % 2)) {
    f.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }
  if (opts.fps) f.push(`fps=${opts.fps}`);
  if (opts.grayscale) f.push('format=gray');
  return f;
}

function trimArgs(opts) {
  const a = [];
  if (opts.start) a.push('-ss', String(opts.start));
  if (opts.end) a.push('-to', String(opts.end));
  return a;
}

async function convert({ input, output, to, opts, ctx }) {
  const info = await probe(input);
  const dur = Math.max(0.1, (opts.end || info.duration) - (opts.start || 0));
  const run = (args) => ffmpeg(args, { duration: dur, onProgress: ctx.onProgress, signal: ctx.signal });
  const pre = [...trimArgs(opts), '-i', input];
  const meta = opts.strip ? ['-map_metadata', '-1'] : ['-map_metadata', '0'];

  // GIF: iki geçişli palet (daha temiz renkler)
  if (to === 'gif') {
    const w = opts.maxWidth || Math.min(info.width || 640, 640);
    const fps = opts.fps || 12;
    return run([...pre, '-vf', `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', output]);
  }

  // Ses çıktısı
  if (AUDIO_OUT.includes(to)) {
    let br = opts.audioBitrate || (opts.quality ? Math.round(64 + (opts.quality / 100) * 256) : 192);
    if (opts.targetBytes && info.duration) br = Math.max(32, Math.floor((opts.targetBytes * 8 * 0.97) / dur / 1000));
    const codec = { mp3: ['-c:a', 'libmp3lame', '-b:a', `${br}k`], m4a: ['-c:a', 'aac', '-b:a', `${br}k`], ogg: ['-c:a', 'libvorbis', '-b:a', `${br}k`], opus: ['-c:a', 'libopus', '-b:a', `${Math.min(br, 256)}k`], wav: ['-c:a', 'pcm_s16le'], flac: ['-c:a', 'flac'] }[to];
    return run([...pre, '-vn', ...meta, ...codec, output]);
  }

  // Video çıktısı
  const vf = scaleFilter(opts, info);
  const crf = opts.quality != null ? Math.round(40 - (opts.quality / 100) * 22) : 23; // 100→18, 50→29
  let v;
  if (to === 'webm') v = ['-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-b:v', '0', '-crf', String(crf + 8), '-c:a', 'libopus', '-b:a', '128k'];
  else if (opts.codec === 'hevc') v = ['-c:v', 'libx265', '-crf', String(crf + 4), '-preset', 'medium', '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '160k'];
  else v = ['-c:v', 'libx264', '-crf', String(crf), '-preset', opts.preset || 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k'];

  if (opts.targetBytes && info.duration) {
    const audioK = info.hasAudio && !opts.mute ? 96 : 0;
    const totalK = (opts.targetBytes * 8 * 0.94) / dur / 1000;
    const videoK = Math.max(80, Math.floor(totalK - audioK));
    const enc = to === 'webm' ? ['-c:v', 'libvpx-vp9', '-row-mt', '1', '-cpu-used', '4', '-deadline', 'good'] : ['-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p'];
    v = [...enc, '-b:v', `${videoK}k`, '-maxrate', `${Math.floor(videoK * 1.3)}k`, '-bufsize', `${videoK * 2}k`,
      ...(audioK ? (to === 'webm' ? ['-c:a', 'libopus'] : ['-c:a', 'aac']).concat(['-b:a', `${audioK}k`]) : [])];
    // Çok düşük bit hızında çözünürlüğü otomatik düşür
    if (!opts.maxWidth && info.width > 1280 && videoK < 1500) vf.unshift(`scale='min(${videoK < 600 ? 854 : 1280},iw)':-2`);
  }
  if (opts.mute) v.push('-an');
  if (to === 'mp4' || to === 'mov') v.push('-movflags', '+faststart');
  return run([...pre, ...(vf.length ? ['-vf', vf.join(',')] : []), ...meta, ...v, output]);
}

// Video → tek kare (küçük resim)
async function frame({ input, output, opts, ctx }) {
  const info = await probe(input);
  const at = opts.at != null ? opts.at : Math.min(1, info.duration / 3);
  return ffmpeg(['-ss', String(at), '-i', input, '-frames:v', '1', '-q:v', '2', output], { signal: ctx.signal });
}

// Video → tüm kareler (klasör). Filee issue #63: "Video Frame Splitting".
async function frames({ input, output, opts, ctx }) {
  const info = await probe(input);
  const dir = output.replace(/\.[^.]+$/, '');
  await fs.promises.mkdir(dir, { recursive: true });
  const ext = opts.frameFormat || 'png';
  const vf = [];
  if (opts.fps) vf.push(`fps=${opts.fps}`);
  if (opts.maxWidth) vf.push(`scale='min(${opts.maxWidth},iw)':-2`);
  await ffmpeg([...trimArgs(opts), '-i', input, ...(vf.length ? ['-vf', vf.join(',')] : []), '-q:v', '2', path.join(dir, `kare_%05d.${ext}`)],
    { duration: info.duration, onProgress: ctx.onProgress, signal: ctx.signal });
  return { outputPath: dir };
}

// Görsel → ffmpeg (BMP/ICO okuma, BMP yazma)
async function stillImage({ input, output, ctx }) {
  return ffmpeg(['-i', input, '-frames:v', '1', output], { signal: ctx.signal });
}

module.exports = [
  {
    id: 'ffmpeg',
    name: 'FFmpeg (video/ses)',
    edges: [
      [VIDEO.filter((x) => x !== 'gif'), [...VIDEO_OUT.filter((x) => x !== 'gif'), ...AUDIO_OUT], 10],
      [VIDEO.filter((x) => x !== 'gif'), ['gif'], 10, { terminal: true }],
      [['gif'], ['mp4', 'webm'], 12, { directOnly: true }],
      [AUDIO, AUDIO_OUT, 10],
    ],
    run: convert,
  },
  {
    id: 'ffmpeg-frame',
    name: 'Video karesi',
    edges: [[VIDEO.filter((x) => x !== 'gif'), ['jpg', 'png'], 15, { directOnly: true }]],
    run: frame,
  },
  {
    id: 'ffmpeg-still',
    name: 'FFmpeg görsel',
    edges: [[['bmp', 'ico'], ['png'], 12], [['png', 'jpg'], ['bmp'], 12]],
    run: stillImage,
  },
];
module.exports.probe = probe;
module.exports.frames = frames;
module.exports.bins = bins;
