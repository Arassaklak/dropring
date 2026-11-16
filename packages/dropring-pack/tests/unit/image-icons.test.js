'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { decodePng, encodePng, resize, squarePad, crc32 } = require('../../builder/image');
const { makeIco, makeIcns, readIco, readIcns, ICO_SIZES, ICNS_TYPES } = require('../../builder/icons');
const { testIconImage } = require('../test-icon');

/** Hand-made PNG of any colour type with filter 0, to test the decoder beyond our own encoder. */
function rawPng(width, height, colorType, depth, rows, extraChunks = []) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = depth; ihdr[9] = colorType;
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), Buffer.from(r)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extraChunks.map(([t, d]) => chunk(t, d)), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('PNG round trip and foreign colour types', () => {
  const img = testIconImage(64);
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 64);
  assert.deepEqual(Buffer.from(back.data), Buffer.from(img.data));
  const gray = decodePng(rawPng(2, 1, 0, 8, [[0, 255]]));
  assert.deepEqual([...gray.data], [0, 0, 0, 255, 255, 255, 255, 255]);
  const pal = decodePng(rawPng(2, 1, 3, 1, [[0b01000000]], [['PLTE', Buffer.from([255, 0, 0, 0, 0, 255])], ['tRNS', Buffer.from([0])]]));
  assert.deepEqual([...pal.data], [255, 0, 0, 0, 0, 0, 255, 255], '1-bit palette with a transparent entry');
  const rgb16 = decodePng(rawPng(1, 1, 2, 16, [[0x12, 0x34, 0xab, 0xcd, 0xff, 0x00]]));
  assert.deepEqual([...rgb16.data], [0x12, 0xab, 0xff, 255]);
  assert.throws(() => decodePng(Buffer.from('GIF89a')), /not a PNG/);
});

test('resize averages in premultiplied alpha and pads to a square', () => {
  const img = { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 0, 0, 0, 255, 255]) }; // transparent red, opaque blue
  const one = resize(img, 1, 1);
  assert.deepEqual([...one.data], [0, 0, 255, 128], 'no dark or red fringe from the transparent pixel');
  const sq = squarePad({ width: 2, height: 1, data: new Uint8Array(8).fill(255) });
  assert.equal(sq.width, 2); assert.equal(sq.height, 2);
});

test('ICO: seven sizes, DIBs below 256 px, PNG at 256 px, readable again', () => {
  const ico = makeIco(testIconImage(512));
  assert.equal(ico.readUInt16LE(4), ICO_SIZES.length);
  const sizes = ICO_SIZES.map((_, i) => ico[6 + i * 16] || 256);
  assert.deepEqual(sizes, ICO_SIZES);
  const first = ico.readUInt32LE(6 + 12);
  assert.equal(ico.readUInt32LE(first), 40, '16 px entry is a BITMAPINFOHEADER');
  assert.equal(ico.readInt32LE(first + 8), 32, 'DIB height is doubled for the AND mask');
  const lastOff = ico.readUInt32LE(6 + (ICO_SIZES.length - 1) * 16 + 12);
  assert.equal(ico.subarray(lastOff, lastOff + 4).toString('latin1'), '\x89PNG');
  assert.equal(readIco(ico).width, 256);
});

test('ICNS: PNG entries up to 1024 px, readable again', () => {
  const icns = makeIcns(testIconImage(256));
  assert.equal(icns.toString('latin1', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  const types = [];
  for (let off = 8; off < icns.length; off += icns.readUInt32BE(off + 4)) types.push(icns.toString('latin1', off, off + 4));
  assert.deepEqual(types, ICNS_TYPES.map(([t]) => t));
  assert.equal(readIcns(icns).width, 1024);
});
