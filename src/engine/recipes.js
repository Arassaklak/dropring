'use strict';
// Tarifler: birden çok adımı tek bırakışta çalıştıran zincirler.
// Adımlar:
//   { op: 'resize', maxWidth, maxHeight }   { op: 'quality', value }
//   { op: 'strip' }  { op: 'grayscale' }   { op: 'rotate', deg }
//   { op: 'target', size: '16MB' }         { op: 'convert', to: 'webp' }
//   { op: 'trim', start, end }              { op: 'fps', value }    { op: 'mute' }
//   { op: 'rename', pattern: '{name}-web' } { op: 'folder', path: 'subfolder' | '~/Desktop' }
//   { op: 'replace' }  (orijinali yedeğe al — geri alınabilir)
//   { op: 'action', id: 'zip-all' | 'strip' | ... }

function parseSize(s) {
  if (typeof s === 'number') return s;
  const m = /^\s*([\d.,]+)\s*(b|kb|k|mb|m|gb|g)?\s*$/i.exec(String(s || ''));
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  const u = (m[2] || 'mb').toLowerCase()[0];
  return Math.floor(n * ({ b: 1, k: 1024, m: 1048576, g: 1073741824 }[u] || 1048576));
}

/** Tarifi dönüşüm aşamalarına çevirir: [{ to, opts }]. Ayar adımları sonraki dönüşüme eklenir. */
function compile(recipe) {
  const stages = [];
  let pending = {};
  for (const s of recipe.steps || []) {
    switch (s.op) {
      case 'resize': pending.maxWidth = s.maxWidth || pending.maxWidth; pending.maxHeight = s.maxHeight || pending.maxHeight; break;
      case 'quality': pending.quality = Number(s.value); break;
      case 'strip': pending.strip = true; break;
      case 'grayscale': pending.grayscale = true; break;
      case 'rotate': pending.rotate = Number(s.deg) || 90; break;
      case 'target': pending.targetBytes = parseSize(s.size); break;
      case 'trim': pending.start = s.start; pending.end = s.end; break;
      case 'fps': pending.fps = Number(s.value); break;
      case 'mute': pending.mute = true; break;
      case 'pages': pending.pages = s.value; break;
      case 'convert': stages.push({ to: s.to, opts: { ...pending, ...(s.opts || {}) } }); pending = {}; break;
      case 'action': stages.push({ action: s.id, opts: { ...pending } }); pending = {}; break;
      default: break; // rename / folder / replace → çıktı ayarı
    }
  }
  if (Object.keys(pending).length || !stages.length) stages.push({ to: 'same', opts: pending });
  return stages;
}

function outputOf(recipe) {
  const o = {};
  for (const s of recipe.steps || []) {
    if (s.op === 'rename') o.pattern = s.pattern;
    if (s.op === 'folder') o.folder = s.path;
    if (s.op === 'replace') o.replaceOriginal = true;
  }
  return o;
}

/** Hazır tarifler — kullanıcı bunları düzenleyebilir, kopyalayabilir. */
const BUILTIN = [
  { id: 'web', name: 'Web için', icon: '🌐', cats: ['image'], steps: [{ op: 'resize', maxWidth: 1920, maxHeight: 1920 }, { op: 'strip' }, { op: 'quality', value: 80 }, { op: 'convert', to: 'webp' }, { op: 'rename', pattern: '{name}-web' }] },
  { id: 'whatsapp', name: "WhatsApp'a sığdır", icon: '💬', cats: ['video'], steps: [{ op: 'target', size: '15MB' }, { op: 'convert', to: 'mp4' }, { op: 'rename', pattern: '{name}-wa' }] },
  { id: 'discord', name: 'Discord (10 MB)', icon: '🎮', cats: ['video', 'image'], steps: [{ op: 'target', size: '9.5MB' }, { op: 'convert', to: 'same' }, { op: 'rename', pattern: '{name}-10mb' }] },
  { id: 'mail', name: 'E-postaya sığdır', icon: '✉', cats: ['video', 'image'], steps: [{ op: 'target', size: '20MB' }, { op: 'convert', to: 'same' }, { op: 'rename', pattern: '{name}-eposta' }] },
  { id: 'insta', name: 'Instagram (1080)', icon: '📷', cats: ['image'], steps: [{ op: 'resize', maxWidth: 1080, maxHeight: 1350 }, { op: 'quality', value: 90 }, { op: 'strip' }, { op: 'convert', to: 'jpg' }, { op: 'rename', pattern: '{name}-ig' }] },
  { id: 'podcast', name: 'Konuşma sesi (MP3 96k)', icon: '🎙', cats: ['audio', 'video'], steps: [{ op: 'convert', to: 'mp3', opts: { audioBitrate: 96 } }] },
  { id: 'scan', name: 'Taramaları PDF yap', icon: '🖨', cats: ['image'], steps: [{ op: 'resize', maxWidth: 2480, maxHeight: 3508 }, { op: 'convert', to: 'pdf', opts: { pageSize: 'A4' } }] },
];


/** Halkanın dış katmanı: hedef formatın üzerinde durunca açılan alt seçenekler (Filee issue #74). */
function subOptions(target, cat) {
  const q = [{ id: 'q-high', label: 'Yüksek', opts: { quality: 92 } }, { id: 'q-mid', label: 'Dengeli', opts: { quality: 78 } }, { id: 'q-low', label: 'Küçük', opts: { quality: 60 } }];
  const sizes = [{ id: 'w-2560', label: '2560px', opts: { maxWidth: 2560, maxHeight: 2560 } }, { id: 'w-1920', label: '1920px', opts: { maxWidth: 1920, maxHeight: 1920 } }, { id: 'w-1080', label: '1080px', opts: { maxWidth: 1080, maxHeight: 1080 } }];
  const targets = [{ id: 't-1', label: '≤ 1 MB', opts: { targetBytes: parseSize('1MB') } }, { id: 't-10', label: '≤ 10 MB', opts: { targetBytes: parseSize('9.5MB') } }, { id: 't-25', label: '≤ 25 MB', opts: { targetBytes: parseSize('24MB') } }];
  if (['jpg', 'webp', 'avif'].includes(target)) return [...q, ...sizes.slice(1), targets[0]];
  if (['png', 'tiff', 'gif'].includes(target) && cat === 'image') return sizes;
  if (['mp4', 'webm', 'mov', 'mkv'].includes(target)) return [{ id: 'v-1080', label: '1080p', opts: { maxWidth: 1920, maxHeight: 1080 } }, { id: 'v-720', label: '720p', opts: { maxWidth: 1280, maxHeight: 720 } }, { id: 'v-mute', label: 'Sessiz', opts: { mute: true } }, ...targets.slice(1), ...(target === 'mp4' ? [{ id: 'v-hevc', label: 'HEVC', opts: { codec: 'hevc' } }] : [])];
  if (['mp3', 'm4a', 'ogg', 'opus'].includes(target)) return [{ id: 'a-320', label: '320k', opts: { audioBitrate: 320 } }, { id: 'a-192', label: '192k', opts: { audioBitrate: 192 } }, { id: 'a-96', label: '96k', opts: { audioBitrate: 96 } }];
  if (target === 'gif') return [{ id: 'g-480', label: '480px', opts: { maxWidth: 480, fps: 12 } }, { id: 'g-720', label: '720px', opts: { maxWidth: 720, fps: 15 } }];
  if (['png', 'jpg'].includes(target) && cat === 'document') return [{ id: 'd-150', label: '150 dpi', opts: { dpi: 150 } }, { id: 'd-300', label: '300 dpi', opts: { dpi: 300 } }, { id: 'p-1', label: 'İlk sayfa', opts: { pages: '1' } }];
  if (target === 'pdf' && cat === 'image') return [{ id: 'a4', label: 'A4 sayfa', opts: { pageSize: 'A4' } }];
  return [];
}

module.exports = { compile, outputOf, parseSize, BUILTIN, subOptions };
