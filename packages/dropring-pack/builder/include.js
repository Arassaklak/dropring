'use strict';
// --include SRC=DEST: extra data files copied into the app's code folder.
//   SRC   file, folder or glob (* ? **), relative to the project folder (or absolute)
//   DEST  folder inside the app, relative ('.' = next to the entry script)
// A folder's contents go into DEST; files and glob matches go into DEST/<name>.

const fs = require('fs');
const path = require('path');
const { walk, toPosix } = require('./util');

function parseSpec(spec) {
  const i = String(spec).lastIndexOf('=');
  if (i <= 0) throw new Error(`--include "${spec}": expected SRC=DEST, e.g. data=data or assets/*.png=assets`);
  const src = spec.slice(0, i);
  const dest = toPosix(spec.slice(i + 1).trim() || '.').replace(/^\.\/+/, '').replace(/\/+$/, '') || '.';
  const parts = dest === '.' ? [] : dest.split('/');
  if (path.isAbsolute(dest) || /^[A-Za-z]:/.test(dest) || parts.some((p) => p === '..' || p === '' || p === '.')) {
    throw new Error(`--include "${spec}": DEST must be a relative folder inside the app (no "..")`);
  }
  return { src, dest: parts.join('/') };
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * Resolves include specs to a list of {from (absolute), to (relative to app/)}.
 * @param {string[]} specs
 * @param {string} root  project folder
 */
async function resolveIncludes(specs, root) {
  const out = new Map();
  const add = (from, to, spec) => {
    if (out.has(to) && out.get(to) !== from) throw new Error(`--include "${spec}": ${to} is already provided by ${out.get(to)}`);
    out.set(to, from);
  };
  for (const spec of specs || []) {
    const { src, dest } = parseSpec(spec);
    const join = (name) => (dest ? `${dest}/${name}` : name);
    const srcPosix = toPosix(src);
    const magic = /[*?]/.test(srcPosix);
    if (!magic) {
      const abs = path.resolve(root, src);
      const st = await fs.promises.stat(abs).catch(() => null);
      if (!st) throw new Error(`--include "${spec}": ${abs} does not exist`);
      if (st.isDirectory()) {
        for (const e of await walk(abs)) if (e.type === 'file') add(e.abs, join(e.rel), spec);
      } else add(abs, join(path.basename(abs)), spec);
      continue;
    }
    // Glob: walk from the longest fixed folder prefix.
    const segments = srcPosix.split('/');
    const fixed = [];
    while (segments.length > 1 && !/[*?]/.test(segments[0])) fixed.push(segments.shift());
    const baseDir = path.resolve(root, fixed.join('/') || '.');
    const re = globToRegExp(segments.join('/'));
    let matched = 0;
    for (const e of await walk(baseDir).catch(() => [])) {
      if (e.type === 'file' && re.test(e.rel)) { add(e.abs, join(path.posix.basename(e.rel)), spec); matched++; }
    }
    if (!matched) throw new Error(`--include "${spec}": no files match`);
  }
  return [...out].map(([to, from]) => ({ from, to })).sort((a, b) => (a.to < b.to ? -1 : 1));
}

module.exports = { resolveIncludes, parseSpec, globToRegExp };
