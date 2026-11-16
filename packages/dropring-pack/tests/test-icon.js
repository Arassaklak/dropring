'use strict';
// Generates a deterministic test icon (a ring with a transparent background), so tests and CI
// exercise the icon pipeline without binary files in the repository.

const fs = require('fs');
const path = require('path');
const { encodePng } = require('../builder/image');

function testIconImage(size = 1024) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2);
      const o = (y * size + x) * 4;
      if (d > 0.55 && d < 0.95) {
        data[o] = Math.round(108 + 100 * (x / size));
        data[o + 1] = 92;
        data[o + 2] = Math.round(231 - 80 * (y / size));
        data[o + 3] = 255;
      } else if (d <= 0.55) {
        data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = Math.round(255 * Math.max(0, 1 - d / 0.55) * 0.6);
      }
    }
  }
  return { width: size, height: size, data };
}

function writeTestIcon(file, size = 1024) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(testIconImage(size)));
  return file;
}

module.exports = { testIconImage, writeTestIcon };

if (require.main === module) console.log(writeTestIcon(process.argv[2] || 'icon.png', Number(process.argv[3]) || 1024));
