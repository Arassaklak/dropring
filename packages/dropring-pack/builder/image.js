'use strict';
// Minimal image toolkit for icons, with no native dependencies: PNG decode/encode and
// high-quality resampling. Images are {width, height, data: Uint8Array RGBA (straight alpha)}.

const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIDE = 8192;
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const isPng = (buf) => buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);

function unfilter(type, line, prev, bpp) {
  const out = new Uint8Array(line.length);
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? out[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let v = line[i];
    switch (type) {
      case 0: break;
      case 1: v += a; break;
      case 2: v += b; break;
      case 3: v += (a + b) >> 1; break;
      case 4: {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        break;
      }
      default: throw new Error(`corrupt PNG: unknown filter type ${type}`);
    }
    out[i] = v & 0xff;
  }
  return out;
}

/** Decodes any standard PNG (all colour types, 1–16 bit, interlaced or not) to RGBA8. */
function decodePng(buf) {
  if (!isPng(buf)) throw new Error('not a PNG file');
  let off = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('corrupt PNG: no IHDR chunk');
  const { width: w, height: h, depth, color, interlace } = ihdr;
  if (!w || !h || w > MAX_SIDE || h > MAX_SIDE) throw new Error(`PNG size ${w}x${h} is not supported (max ${MAX_SIDE})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error(`unsupported PNG format (colour type ${color}, depth ${depth})`);
  if (color === 3 && !palette) throw new Error('corrupt PNG: palette image without PLTE');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8Array(w * h * 4);
  const maxSample = (1 << Math.min(depth, 8)) - 1;
  let pos = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPerPixel) / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      if (pos + 1 + stride > raw.length) throw new Error('corrupt PNG: image data too short');
      const cur = unfilter(raw[pos], raw.subarray(pos + 1, pos + 1 + stride), prev, bpp);
      pos += 1 + stride;
      for (let x = 0; x < pw; x++) {
        let r, g, b, a = 255;
        if (depth < 8) {
          const bit = x * depth;
          const sample = (cur[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
          if (color === 3) {
            r = palette[sample * 3]; g = palette[sample * 3 + 1]; b = palette[sample * 3 + 2];
            if (trns && sample < trns.length) a = trns[sample];
          } else {
            r = g = b = Math.round((sample * 255) / maxSample);
            if (trns && trns.length >= 2 && sample === trns.readUInt16BE(0)) a = 0;
          }
        } else {
          const s = depth === 16 ? 2 : 1; // 16-bit: use the high byte
          const v = (k) => cur[(x * channels + k) * s];
          const v16 = (k) => (s === 2 ? (cur[(x * channels + k) * 2] << 8) | cur[(x * channels + k) * 2 + 1] : cur[x * channels + k]);
          if (color === 0) { r = g = b = v(0); if (trns && trns.length >= 2 && v16(0) === trns.readUInt16BE(0)) a = 0; }
          else if (color === 2) {
            r = v(0); g = v(1); b = v(2);
            if (trns && trns.length >= 6 && v16(0) === trns.readUInt16BE(0) && v16(1) === trns.readUInt16BE(2) && v16(2) === trns.readUInt16BE(4)) a = 0;
          } else if (color === 3) { const i = cur[x]; r = palette[i * 3]; g = palette[i * 3 + 1]; b = palette[i * 3 + 2]; if (trns && i < trns.length) a = trns[i]; }
          else if (color === 4) { r = g = b = v(0); a = v(1); }
          else { r = v(0); g = v(1); b = v(2); a = v(3); }
        }
        const o = ((y0 + y * dy) * w + (x0 + x * dx)) * 4;
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
      }
      prev = cur;
    }
  }
  return { width: w, height: h, data: out };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes RGBA8 as PNG (per-row adaptive filtering, maximum compression). */
function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = data.subarray(y * stride, (y + 1) * stride);
    let best = null;
    let bestScore = Infinity;
    for (let type = 0; type <= 4; type++) {
      const f = new Uint8Array(stride);
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? line[i - 4] : 0;
        const b = prev[i];
        const c = i >= 4 ? prev[i - 4] : 0;
        let p;
        if (type === 0) p = 0;
        else if (type === 1) p = a;
        else if (type === 2) p = b;
        else if (type === 3) p = (a + b) >> 1;
        else {
          const q = a + b - c;
          const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        f[i] = (line[i] - p) & 0xff;
        score += f[i] < 128 ? f[i] : 256 - f[i];
      }
      if (score < bestScore) { bestScore = score; best = [type, f]; }
    }
    raw[y * (stride + 1)] = best[0];
    raw.set(best[1], y * (stride + 1) + 1);
    prev = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Per-destination-pixel source weights: area averaging when shrinking, bilinear when enlarging. */
function weights(srcLen, dstLen) {
  const out = [];
  const scale = srcLen / dstLen;
  for (let d = 0; d < dstLen; d++) {
    const list = [];
    if (scale >= 1) {
      const start = d * scale;
      const end = start + scale;
      for (let s = Math.floor(start); s < Math.min(srcLen, Math.ceil(end)); s++) {
        const overlap = Math.min(end, s + 1) - Math.max(start, s);
        if (overlap > 0) list.push([s, overlap / scale]);
      }
    } else {
      const center = (d + 0.5) * scale - 0.5;
      const s0 = Math.floor(center);
      const t = center - s0;
      list.push([Math.min(srcLen - 1, Math.max(0, s0)), 1 - t], [Math.min(srcLen - 1, Math.max(0, s0 + 1)), t]);
    }
    out.push(list);
  }
  return out;
}

/** Resamples in premultiplied alpha, so transparent edges do not darken. */
function resize(img, dw, dh) {
  if (img.width === dw && img.height === dh) return img;
  const { width: sw, height: sh, data } = img;
  const pm = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = data[i * 4 + 3] / 255;
    pm[i * 4] = data[i * 4] * a; pm[i * 4 + 1] = data[i * 4 + 1] * a; pm[i * 4 + 2] = data[i * 4 + 2] * a; pm[i * 4 + 3] = a;
  }
  const wx = weights(sw, dw);
  const tmp = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      const o = (y * dw + x) * 4;
      for (const [s, wgt] of wx[x]) {
        const i = (y * sw + s) * 4;
        tmp[o] += pm[i] * wgt; tmp[o + 1] += pm[i + 1] * wgt; tmp[o + 2] += pm[i + 2] * wgt; tmp[o + 3] += pm[i + 3] * wgt;
      }
    }
  }
  const wy = weights(sh, dh);
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [s, wgt] of wy[y]) {
        const i = (s * dw + x) * 4;
        r += tmp[i] * wgt; g += tmp[i + 1] * wgt; b += tmp[i + 2] * wgt; a += tmp[i + 3] * wgt;
      }
      const o = (y * dw + x) * 4;
      const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
      out[o + 3] = clamp(a * 255);
      if (a > 0) { out[o] = clamp(r / a); out[o + 1] = clamp(g / a); out[o + 2] = clamp(b / a); }
    }
  }
  return { width: dw, height: dh, data: out };
}

/** Centres a non-square image on a transparent square canvas. */
function squarePad(img) {
  if (img.width === img.height) return img;
  const side = Math.max(img.width, img.height);
  const out = new Uint8Array(side * side * 4);
  const ox = (side - img.width) >> 1;
  const oy = (side - img.height) >> 1;
  for (let y = 0; y < img.height; y++) out.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + oy) * side + ox) * 4);
  return { width: side, height: side, data: out };
}

module.exports = { decodePng, encodePng, resize, squarePad, isPng, crc32 };
