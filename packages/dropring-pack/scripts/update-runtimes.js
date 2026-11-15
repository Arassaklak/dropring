#!/usr/bin/env node
'use strict';
// Maintainer tool: pins python-build-standalone runtimes in runtime/runtimes.json.
//
//   node scripts/update-runtimes.js --release 20261110 [--minor 3.11,3.12,...] [--default 3.14]
//
// Reads the release's SHA256SUMS over HTTPS and records, for every requested minor version,
// the CPython version and the SHA-256 of each target archive. Existing entries for other
// minors are kept, so EOL versions can stay pinned to an older release.

const fs = require('fs');
const path = require('path');

const FLAVOR = 'install_only_stripped';
const TRIPLES = [
  'x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc',
  'aarch64-apple-darwin', 'x86_64-apple-darwin',
  'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu',
];
const FILE = path.join(__dirname, '..', 'runtime', 'runtimes.json');
const BASE = 'https://github.com/astral-sh/python-build-standalone/releases/download';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const release = arg('release');
  if (!/^\d{8}$/.test(release || '')) throw new Error('usage: --release YYYYMMDD [--minor 3.11,3.12] [--default 3.14]');
  const res = await fetch(`${BASE}/${release}/SHA256SUMS`);
  if (!res.ok) throw new Error(`cannot fetch SHA256SUMS for ${release}: HTTP ${res.status}`);
  const sums = new Map();
  for (const line of (await res.text()).split('\n')) {
    const m = /^([0-9a-f]{64})\s+(\S+)$/.exec(line.trim());
    if (m) sums.set(m[2], m[1]);
  }
  const versions = new Map(); // minor -> full version (final releases only)
  for (const name of sums.keys()) {
    const m = new RegExp(`^cpython-(3\\.(\\d+)\\.(\\d+))\\+${release}-`).exec(name);
    if (m) versions.set(`3.${m[2]}`, m[1]);
  }
  const wanted = (arg('minor') || [...versions.keys()].join(',')).split(',').filter(Boolean);
  const doc = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {
    schema: 1,
    source: 'python-build-standalone',
    repository: 'https://github.com/astral-sh/python-build-standalone',
    flavor: FLAVOR,
    urlTemplate: `${BASE}/{release}/cpython-{version}%2B{release}-{triple}-{flavor}.tar.gz`,
    default: '3.14',
    runtimes: {},
  };
  for (const minor of wanted) {
    const version = versions.get(minor);
    if (!version) throw new Error(`release ${release} has no final CPython ${minor}`);
    const assets = {};
    for (const triple of TRIPLES) {
      const sha = sums.get(`cpython-${version}+${release}-${triple}-${FLAVOR}.tar.gz`);
      if (sha) assets[triple] = sha;
    }
    doc.runtimes[minor] = { ...(doc.runtimes[minor] || {}), version, release, assets };
    console.log(`${minor}: ${version} (${release}) — ${Object.keys(assets).length} targets`);
  }
  if (arg('default')) doc.default = arg('default');
  if (arg('eol')) for (const m of arg('eol').split(',')) if (doc.runtimes[m]) doc.runtimes[m].endOfLife = true;
  const sorted = Object.fromEntries(Object.entries(doc.runtimes).sort(([a], [b]) => Number(a.split('.')[1]) - Number(b.split('.')[1])));
  doc.runtimes = sorted;
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
