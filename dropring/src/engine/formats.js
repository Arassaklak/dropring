'use strict';
// Format kaydı: her formatın kimliği, kategorisi, uzantıları ve MIME türleri.
// Kimlik = uzantı (küçük harf). Eş anlamlılar (jpeg → jpg) burada çözülür.

const FORMATS = [
  // Görseller
  { id: 'jpg', cat: 'image', label: 'JPG', ext: ['jpg', 'jpeg', 'jfif'], mime: ['image/jpeg'] },
  { id: 'png', cat: 'image', label: 'PNG', ext: ['png'], mime: ['image/png'] },
  { id: 'webp', cat: 'image', label: 'WebP', ext: ['webp'], mime: ['image/webp'] },
  { id: 'avif', cat: 'image', label: 'AVIF', ext: ['avif'], mime: ['image/avif'] },
  { id: 'gif', cat: 'image', label: 'GIF', ext: ['gif'], mime: ['image/gif'] },
  { id: 'tiff', cat: 'image', label: 'TIFF', ext: ['tif', 'tiff'], mime: ['image/tiff'] },
  { id: 'bmp', cat: 'image', label: 'BMP', ext: ['bmp'], mime: ['image/bmp'] },
  { id: 'ico', cat: 'image', label: 'ICO', ext: ['ico'], mime: ['image/x-icon', 'image/vnd.microsoft.icon'] },
  { id: 'heic', cat: 'image', label: 'HEIC', ext: ['heic', 'heif'], mime: ['image/heic', 'image/heif'] },
  { id: 'svg', cat: 'image', label: 'SVG', ext: ['svg'], mime: ['image/svg+xml'] },

  // Video
  { id: 'mp4', cat: 'video', label: 'MP4', ext: ['mp4', 'm4v'], mime: ['video/mp4'] },
  { id: 'mov', cat: 'video', label: 'MOV', ext: ['mov'], mime: ['video/quicktime'] },
  { id: 'mkv', cat: 'video', label: 'MKV', ext: ['mkv'], mime: ['video/x-matroska'] },
  { id: 'webm', cat: 'video', label: 'WebM', ext: ['webm'], mime: ['video/webm'] },
  { id: 'avi', cat: 'video', label: 'AVI', ext: ['avi'], mime: ['video/x-msvideo', 'video/avi'] },
  { id: 'wmv', cat: 'video', label: 'WMV', ext: ['wmv'], mime: ['video/x-ms-wmv'] },
  { id: 'flv', cat: 'video', label: 'FLV', ext: ['flv'], mime: ['video/x-flv'] },
  { id: 'mpeg', cat: 'video', label: 'MPEG', ext: ['mpg', 'mpeg'], mime: ['video/mpeg'] },
  { id: 'ts', cat: 'video', label: 'TS', ext: ['ts', 'm2ts', 'mts'], mime: ['video/mp2t'] },
  { id: '3gp', cat: 'video', label: '3GP', ext: ['3gp'], mime: ['video/3gpp'] },

  // Ses
  { id: 'mp3', cat: 'audio', label: 'MP3', ext: ['mp3'], mime: ['audio/mpeg', 'audio/mp3'] },
  { id: 'm4a', cat: 'audio', label: 'M4A', ext: ['m4a'], mime: ['audio/mp4', 'audio/x-m4a'] },
  { id: 'aac', cat: 'audio', label: 'AAC', ext: ['aac'], mime: ['audio/aac'] },
  { id: 'wav', cat: 'audio', label: 'WAV', ext: ['wav'], mime: ['audio/wav', 'audio/x-wav', 'audio/wave'] },
  { id: 'flac', cat: 'audio', label: 'FLAC', ext: ['flac'], mime: ['audio/flac', 'audio/x-flac'] },
  { id: 'ogg', cat: 'audio', label: 'OGG', ext: ['ogg', 'oga'], mime: ['audio/ogg'] },
  { id: 'opus', cat: 'audio', label: 'Opus', ext: ['opus'], mime: ['audio/opus'] },
  { id: 'wma', cat: 'audio', label: 'WMA', ext: ['wma'], mime: ['audio/x-ms-wma'] },
  { id: 'aiff', cat: 'audio', label: 'AIFF', ext: ['aif', 'aiff'], mime: ['audio/aiff', 'audio/x-aiff'] },

  // Belgeler
  { id: 'pdf', cat: 'document', label: 'PDF', ext: ['pdf'], mime: ['application/pdf'] },
  { id: 'docx', cat: 'document', label: 'Word', ext: ['docx'], mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  { id: 'md', cat: 'document', label: 'Markdown', ext: ['md', 'markdown'], mime: ['text/markdown'] },
  { id: 'html', cat: 'document', label: 'HTML', ext: ['html', 'htm'], mime: ['text/html'] },
  { id: 'txt', cat: 'document', label: 'TXT', ext: ['txt', 'log', 'text'], mime: ['text/plain'] },

  // Tablolar ve veri
  { id: 'xlsx', cat: 'data', label: 'Excel', ext: ['xlsx', 'xlsm'], mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  { id: 'xls', cat: 'data', label: 'XLS', ext: ['xls'], mime: ['application/vnd.ms-excel'] },
  { id: 'ods', cat: 'data', label: 'ODS', ext: ['ods'], mime: ['application/vnd.oasis.opendocument.spreadsheet'] },
  { id: 'csv', cat: 'data', label: 'CSV', ext: ['csv'], mime: ['text/csv'] },
  { id: 'tsv', cat: 'data', label: 'TSV', ext: ['tsv', 'tab'], mime: ['text/tab-separated-values'] },
  { id: 'json', cat: 'data', label: 'JSON', ext: ['json'], mime: ['application/json'] },
  { id: 'yaml', cat: 'data', label: 'YAML', ext: ['yaml', 'yml'], mime: ['application/yaml', 'text/yaml', 'application/x-yaml'] },
  { id: 'xml', cat: 'data', label: 'XML', ext: ['xml'], mime: ['application/xml', 'text/xml'] },

  // Arşivler
  { id: 'zip', cat: 'archive', label: 'ZIP', ext: ['zip'], mime: ['application/zip', 'application/x-zip-compressed'] },
  { id: 'tgz', cat: 'archive', label: 'TAR.GZ', ext: ['tgz', 'tar.gz'], mime: ['application/gzip', 'application/x-gzip'] },
  { id: 'tar', cat: 'archive', label: 'TAR', ext: ['tar'], mime: ['application/x-tar'] },
];

const byId = new Map(FORMATS.map((f) => [f.id, f]));
const byExt = new Map();
for (const f of FORMATS) for (const e of f.ext) byExt.set(e, f);
const byMime = new Map();
for (const f of FORMATS) for (const m of f.mime) byMime.set(m, f);

/** Dosya yolundan format kimliği. Bilinmiyorsa null. */
function detect(filePath) {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'tgz';
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const f = byExt.get(lower.slice(dot + 1));
  return f ? f.id : null;
}

/** MIME türünden format kimliği (sürükleme sırasında dosya adı henüz bilinmezken). */
function fromMime(mime) {
  const f = byMime.get(String(mime || '').toLowerCase());
  return f ? f.id : null;
}

function get(id) { return byId.get(id) || null; }
function ext(id) { const f = byId.get(id); return f ? (f.id === 'tgz' ? 'tar.gz' : f.ext[0]) : id; }
function category(id) { const f = byId.get(id); return f ? f.cat : null; }

module.exports = { FORMATS, detect, fromMime, get, ext, category };
