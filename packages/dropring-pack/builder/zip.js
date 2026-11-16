'use strict';
// Deterministic zip writer for app archives (--zip). Stores Unix permissions in the external
// attributes, so a macOS app zipped on Windows still has an executable launcher after
// unzipping, and stores symlinks as links. Entries are sorted; timestamps are fixed.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { crc32 } = require('./image');
const { walk } = require('./util');

function dosDateTime(date) {
  const d = new Date(Math.max(date.getTime(), Date.UTC(1980, 0, 1)));
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const day = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, day };
}

/**
 * Zips `dir` (the folder itself becomes the top-level entry) into `outFile`.
 * @param {string} dir
 * @param {string} outFile
 * @param {{date: Date, modeOf: (rel: string, type: string) => number}} o  modeOf returns permission bits
 */
async function zipDirectory(dir, outFile, { date, modeOf }) {
  const top = path.basename(dir);
  const entries = [{ rel: '', type: 'dir', abs: dir }, ...(await walk(dir))];
  const { time, day } = dosDateTime(date);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = e.rel ? `${top}/${e.rel}${e.type === 'dir' ? '/' : ''}` : `${top}/`;
    const nameBuf = Buffer.from(name, 'utf8');
    let data = Buffer.alloc(0);
    let typeBits = 0o040000;
    if (e.type === 'file') { data = await fs.promises.readFile(e.abs); typeBits = 0o100000; }
    else if (e.type === 'symlink') { data = Buffer.from((await fs.promises.readlink(e.abs)).split(path.sep).join('/'), 'utf8'); typeBits = 0o120000; }
    const mode = typeBits | (e.type === 'symlink' ? 0o777 : modeOf(e.rel, e.type));
    const crc = crc32(data);
    let method = 0;
    let stored = data;
    if (e.type === 'file' && data.length > 0) {
      const deflated = zlib.deflateRawSync(data, { level: 9 });
      if (deflated.length < data.length) { method = 8; stored = deflated; }
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, stored);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, spec 2.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(((mode << 16) | (e.type === 'dir' ? 0x10 : 0)) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + stored.length;
  }
  const cdBuf = Buffer.concat(central);
  const count = entries.length;
  if (count > 0xffff || offset > 0xffffffff) throw new Error('app is too large for a zip without zip64 (more than 65535 files or 4 GB)');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  const tmp = `${outFile}.part`;
  await fs.promises.writeFile(tmp, Buffer.concat([...chunks, cdBuf, end]));
  await fs.promises.rename(tmp, outFile);
  return outFile;
}

module.exports = { zipDirectory, dosDateTime };
