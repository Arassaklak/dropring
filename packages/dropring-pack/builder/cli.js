#!/usr/bin/env node
'use strict';
// dropring-pack command line.

const fs = require('fs');
const path = require('path');
const { build, listRuntimes, VERSION, TARGETS, hostTargetId } = require('./index');
const { resolveRuntime, ensureRuntime } = require('./runtime');
const { parseTargets } = require('./targets');
const { cacheRoot } = require('./cache');

const HELP = `dropring-pack ${VERSION} — package a Python script as a standalone app

Usage:
  dropring-pack build <entry.py | project-dir> [options]
  dropring-pack runtimes list
  dropring-pack runtimes fetch [--python 3.14] [--target win-x64,mac-arm64]
  dropring-pack runtimes prune
  dropring-pack inspect <app>             show manifest, size breakdown, launcher hash
  dropring-pack doctor                    check cache, network access, tools

Build options:
  --target <list>        ${Object.keys(TARGETS).join(', ')}, host, all (default: host = ${hostTargetId() || 'unsupported'})
  --name <name>          application name (default: script or folder name)
  --app-id <id>          reverse-DNS id, e.g. com.example.myapp
  --version <x.y.z>      numeric version (default 1.0.0)
  --python <3.x>         runtime version (default ${listRuntimes().find((r) => r.default).minor})
  --entry <file>         entry script inside a project folder
  --windowed | --console GUI app without a console window on Windows (default: console)
  --out <dir>            output folder (default: dist); apps go to <dir>/<target>/
  --flat                 single target: put the app directly into --out
  --launcher-dir <dir>   prebuilt launchers: <dir>/<target>/dropring-pack-<console|windowed>[.exe]
  --mac-sign adhoc|none  macOS signing (default adhoc; Developer ID arrives in M3)
  --no-utf8-mode         do not enable Python UTF-8 mode in the app
  --json                 machine-readable events, one JSON object per line

Planned (not yet available): --mode onefile (M4), --icon, --include, --sign-cmd, --zip (M1),
--requirements, --hidden-import, --exclude-module, --hooks, --env (M2), --trace (M5), --fallback (M7).
Environment: DROPRING_PACK_CACHE, DROPRING_PACK_OFFLINE=1, DROPRING_PACK_RUNTIME_MIRROR, SOURCE_DATE_EPOCH.`;

const FLAG_MAP = {
  '--target': 'targets', '--targets': 'targets', '--name': 'name', '--app-id': 'appId', '--version': 'version',
  '--python': 'python', '--entry': 'entryInProject', '--out': 'out', '-o': 'out', '--launcher-dir': 'launcherDir',
  '--mac-sign': 'macSign', '--mode': 'mode', '--icon': 'icon', '--include': 'include', '--sign-cmd': 'signCmd',
  '--requirements': 'requirements', '--hidden-import': 'hiddenImport', '--exclude-module': 'excludeModule',
  '--hooks': 'hooks', '--env': 'env', '--fallback': 'fallback',
};
const BOOL_FLAGS = { '--windowed': ['windowed', true], '--console': ['windowed', false], '--flat': ['flat', true], '--no-utf8-mode': ['utf8Mode', false], '--json': ['json', true], '--trace': ['trace', true], '--zip': ['zip', true] };

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (FLAG_MAP[flag]) {
      const value = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (value === undefined) throw new UsageError(`${flag} needs a value`);
      opts[FLAG_MAP[flag]] = value;
    } else if (BOOL_FLAGS[flag]) {
      const [key, value] = BOOL_FLAGS[flag];
      opts[key] = value;
    } else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-V') opts.showVersion = true;
    else if (a.startsWith('-') && a.length > 1) throw new UsageError(`unknown option ${a}`);
    else opts._.push(a);
  }
  return opts;
}

function humanReporter() {
  return (e) => {
    const prefix = e.target ? `[${e.target}] ` : '';
    if (e.type === 'stage') console.log(`${prefix}${e.stage.padEnd(8)} ${e.message || ''}`);
    else if (e.type === 'warning') console.warn(`${prefix}warning: ${e.message}`);
    else if (e.type === 'progress') { if (e.value === 1 || Math.round(e.value * 100) % 25 === 0) console.log(`${prefix}fetch    ${Math.round(e.value * 100)}% of ${(e.total / 1048576).toFixed(1)} MB`); }
    else if (e.type === 'log' && (e.level !== 'debug' || process.env.DROPRING_PACK_DEBUG)) console.log(`${prefix}${e.message}`);
  };
}

async function cmdBuild(opts) {
  const entry = opts._[1];
  if (!entry) throw new UsageError('build needs an entry script or project folder');
  const json = opts.json;
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const { _, help, json: _j, showVersion, ...rest } = opts;
  const result = await build({ ...rest, entry, signal: controller.signal }, json ? (e) => process.stdout.write(JSON.stringify(e) + '\n') : humanReporter());
  if (json) process.stdout.write(JSON.stringify({ type: 'result', artifacts: result.artifacts, warnings: result.warnings }) + '\n');
  else for (const a of result.artifacts) console.log(`\nbuilt ${a.target}: ${a.executable}`);
}

async function cmdRuntimes(opts) {
  const sub = opts._[1] || 'list';
  if (sub === 'list') {
    for (const r of listRuntimes()) {
      console.log(`${r.minor.padEnd(5)} ${r.version.padEnd(8)} pbs-${r.release}${r.default ? '  (default)' : ''}${r.endOfLife ? '  end-of-life' : ''}  ${r.triples.join(' ')}`);
    }
    console.log(`cache: ${cacheRoot()}`);
  } else if (sub === 'fetch') {
    for (const target of parseTargets(opts.targets)) {
      const spec = resolveRuntime(opts.python, target);
      const r = await ensureRuntime(spec);
      console.log(`${target.id}: Python ${spec.version} ${r.cached ? 'already cached' : 'downloaded and verified'} → ${r.root}`);
    }
  } else if (sub === 'prune') {
    const root = cacheRoot();
    const keep = new Set(listRuntimes().flatMap((r) => Object.values(require('../runtime/runtimes.json').runtimes[r.minor].assets)));
    let freed = 0;
    for (const kind of ['downloads', 'runtimes']) {
      const dir = path.join(root, kind);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (keep.has(name)) continue;
        const p = path.join(dir, name);
        freed += dirSize(p);
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
    console.log(`removed unpinned cache entries (${(freed / 1048576).toFixed(1)} MB) from ${root}`);
  } else throw new UsageError(`unknown runtimes command "${sub}"`);
}

function dirSize(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, c) => n + dirSize(path.join(p, c)), 0);
}

function cmdInspect(opts) {
  const target = opts._[1];
  if (!target) throw new UsageError('inspect needs the path of an app');
  const candidates = [path.join(target, 'Contents', 'Resources', 'manifest.json'), path.join(target, '_internal', 'manifest.json')];
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) throw new Error(`${target} has no dropring-pack manifest`);
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (opts.json) return console.log(JSON.stringify(m, null, 2));
  const groups = new Map();
  for (const f of m.files) {
    // Large files on their own line, everything else by folder (two levels below python/).
    const parts = f.path.split('/');
    const i = parts.indexOf('python');
    const key = f.size >= 1048576 ? f.path : i >= 0 ? parts.slice(0, Math.min(parts.length - 1, i + 3)).join('/') : parts.slice(0, -1).join('/') || '.';
    groups.set(key, (groups.get(key) || 0) + f.size);
  }
  console.log(`${m.app.name} ${m.app.version} (${m.app.appId}) — ${m.target.id}, ${m.app.mode}, ${m.app.subsystem}`);
  console.log(`engine: ${m.engine} ${m.generatorVersion}; Python ${m.python.version} (python-build-standalone ${m.python.release}, archive ${m.python.archiveSha256.slice(0, 16)}…)`);
  console.log(`launcher: ${m.launcher.kind} ${m.launcher.version}, sha256 ${m.launcher.sha256}`);
  console.log(`files: ${m.totals.count}, ${(m.totals.bytes / 1048576).toFixed(1)} MB (without the executable)`);
  for (const [k, v] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${(v / 1048576).toFixed(2).padStart(7)} MB  ${k}`);
}

async function cmdDoctor() {
  const checks = [];
  const add = (ok, name, detail) => checks.push({ ok, name, detail });
  const [major] = process.versions.node.split('.').map(Number);
  add(major >= 20, 'Node.js', process.versions.node);
  const root = cacheRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.accessSync(root, fs.constants.W_OK);
    add(true, 'cache folder', root);
  } catch (e) { add(false, 'cache folder', `${root}: ${e.message}`); }
  try {
    const res = await fetch('https://github.com/astral-sh/python-build-standalone/releases', { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    add(res.ok, 'runtime downloads (github.com)', `HTTP ${res.status}`);
  } catch (e) { add(process.env.DROPRING_PACK_OFFLINE === '1', 'runtime downloads (github.com)', e.message); }
  if (process.platform === 'darwin') add(fs.existsSync('/usr/bin/codesign'), 'codesign (macOS signing)', '/usr/bin/codesign');
  const { findLauncher } = require('./launchers');
  for (const id of Object.keys(TARGETS)) {
    try { const l = await findLauncher(TARGETS[id], 'console'); add(true, `launcher ${id}`, l.path); } catch { add(id !== hostTargetId(), `launcher ${id}`, 'not found (needed only when building for this target)'); }
  }
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}: ${c.detail}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

async function main(argv) {
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-V')) return console.log(VERSION);
  const opts = parseArgs(argv);
  const cmd = opts._[0];
  if (opts.showVersion) return console.log(VERSION);
  if (opts.help || !cmd) return console.log(HELP);
  if (cmd === 'build') return cmdBuild(opts);
  if (cmd === 'runtimes') return cmdRuntimes(opts);
  if (cmd === 'inspect') return cmdInspect(opts);
  if (cmd === 'doctor') return cmdDoctor();
  throw new UsageError(`unknown command "${cmd}"`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`dropring-pack: ${err.message}`);
    process.exitCode = err instanceof UsageError ? 2 : 1;
  });
}

module.exports = { parseArgs, main };
