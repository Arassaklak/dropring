'use strict';
// App icons: read PNG, ICO, ICNS (and SVG when a rasteriser is available) and produce a
// multi-size Windows .ico and a macOS .icns. Pure JavaScript, deterministic output.

const fs = require('fs');
const path = require('path');
const { decodePng, encodePng, resize, squarePad, isPng } = require('./image');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// [OSType, pixel size]; the set Apple's iconutil writes, all PNG payloads (macOS 10.7+).
// 'icp6' is left out: iconutil reads it as 48 px, while some references list 64 px.
const ICNS_TYPES = [['icp4', 16], ['icp5', 32], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];

/** 32-bit DIB with AND mask, as stored inside .ico files (bottom-up BGRA). */
function encodeDib({ width, height, data }) {
  const maskStride = Math.ceil(width / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8); // colour + mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(width * height * 4 + maskStride * height, 20);
  const pixels = Buffer.alloc(width * height * 4);
  const mask = Buffer.alloc(maskStride * height);
  for (let y = 0; y < height; y++) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = (row * width + x) * 4;
      pixels[o] = data[i + 2]; pixels[o + 1] = data[i + 1]; pixels[o + 2] = data[i]; pixels[o + 3] = data[i + 3];
      if (data[i + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

/** Windows icon with all standard sizes: DIBs up to 128 px, PNG for 256 px. */
function makeIco(img) {
  const images = ICO_SIZES.map((s) => {
    const r = resize(img, s, s);
    return { size: s, data: s >= 256 ? encodePng(r) : encodeDib(r) };
  });
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((im, i) => {
    const e = 6 + i * 16;
    head[e] = im.size >= 256 ? 0 : im.size;
    head[e + 1] = im.size >= 256 ? 0 : im.size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(im.data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += im.data.length;
  });
  return Buffer.concat([head, ...images.map((im) => im.data)]);
}

/** macOS icon family with PNG payloads from 16 to 1024 px. */
function makeIcns(img) {
  const rendered = new Map();
  const png = (s) => {
    if (!rendered.has(s)) rendered.set(s, encodePng(resize(img, s, s)));
    return rendered.get(s);
  };
  const entries = ICNS_TYPES.map(([type, size]) => {
    const data = png(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

function decodeDib(buf) {
  const width = buf.readInt32LE(4);
  const height = Math.abs(buf.readInt32LE(8)) / 2;
  const bits = buf.readUInt16LE(14);
  const headerSize = buf.readUInt32LE(0);
  if (bits !== 32 && bits !== 24) throw new Error(`ICO images with ${bits}-bit colour are not supported; use a PNG icon`);
  const bytes = bits / 8;
  const stride = Math.ceil((width * bytes) / 4) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const maskStart = headerSize + stride * height;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const i = headerSize + row * stride + x * bytes;
      const o = (y * width + x) * 4;
      out[o] = buf[i + 2]; out[o + 1] = buf[i + 1]; out[o + 2] = buf[i];
      if (bits === 32) out[o + 3] = buf[i + 3];
      else out[o + 3] = buf[maskStart + row * maskStride + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 255;
    }
  }
  return { width, height, data: out };
}

/** Largest image of an .ico file. */
function readIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('not an ICO file');
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = buf[e] || 256;
    const bits = buf.readUInt16LE(e + 6);
    const data = buf.subarray(buf.readUInt32LE(e + 12), buf.readUInt32LE(e + 12) + buf.readUInt32LE(e + 8));
    if (!best || size > best.size || (size === best.size && bits > best.bits)) best = { size, bits, data };
  }
  if (!best) throw new Error('the ICO file contains no images');
  return isPng(best.data) ? decodePng(best.data) : decodeDib(best.data);
}

/** Largest PNG image of an .icns file. */
function readIcns(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'icns') throw new Error('not an ICNS file');
  let best = null;
  for (let off = 8; off + 8 <= buf.length;) {
    const len = buf.readUInt32BE(off + 4);
    if (len < 8) break;
    const data = buf.subarray(off + 8, off + len);
    if (isPng(data)) {
      const width = data.readUInt32BE(16);
      if (!best || width > best.width) best = { width, data };
    }
    off += len;
  }
  if (!best) throw new Error('the ICNS file has no PNG images (old JPEG 2000 or RLE icons are not supported); use a PNG icon');
  return decodePng(best.data);
}

async function rasterizeSvg(buf, size) {
  try {
    const sharp = require('sharp');
    const png = await sharp(buf, { density: 384 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    return decodePng(png);
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  try {
    const { Resvg } = require('@resvg/resvg-js');
    return decodePng(Buffer.from(new Resvg(buf, { fitTo: { mode: 'width', value: size } }).render().asPng()));
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  throw new Error('SVG icons need the "sharp" or "@resvg/resvg-js" package (DropRing ships sharp); or pass a PNG of at least 1024x1024');
}

/**
 * Loads an icon source. Returns the largest square image, plus the original bytes when the
 * file is already in a target's native format (.ico for Windows, .icns for macOS).
 * @returns {Promise<{image: {width: number, height: number, data: Uint8Array}, ico: Buffer|null, icns: Buffer|null, warnings: string[]}>}
 */
async function loadIcon(file) {
  const buf = await fs.promises.readFile(file);
  const ext = path.extname(file).toLowerCase();
  let image;
  let ico = null;
  let icns = null;
  if (ext === '.png') image = decodePng(buf);
  else if (ext === '.ico') { image = readIco(buf); ico = buf; }
  else if (ext === '.icns') { image = readIcns(buf); icns = buf; }
  else if (ext === '.svg') image = await rasterizeSvg(buf, 1024);
  else throw new Error(`unsupported icon format "${ext}" (use .png, .ico, .icns or .svg)`);
  const warnings = [];
  if (image.width !== image.height) warnings.push(`icon is ${image.width}x${image.height}; it was centred on a square canvas`);
  image = squarePad(image);
  if (image.width < 256) warnings.push(`icon source is only ${image.width}px; large icon sizes will look blurry (use at least 512px, 1024px for macOS)`);
  return { image, ico, icns, warnings };
}

module.exports = { loadIcon, makeIco, makeIcns, readIco, readIcns, encodeDib, ICO_SIZES, ICNS_TYPES };
