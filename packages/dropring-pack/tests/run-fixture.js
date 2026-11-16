#!/usr/bin/env node
'use strict';
// Runs a built app against a fixture's expected.json and reports wall-clock start-to-exit time.
//
//   node tests/run-fixture.js <fixture-dir> <app> [--repeat N] [--json]
//
// <app> is a .app bundle, a Windows app folder, or the executable itself. The app runs from a
// neutral working directory so it cannot depend on the caller's cwd. expected.json keys:
//   args, env, stdin            input
//   exitCode, stdout, stderr    exact stdout (trimmed), stderr substring
//   stdoutJson / outputJson     subset of the JSON printed last / written to $DRP_FIXTURE_OUT
//   outputFile: true            give the app DRP_FIXTURE_OUT (windowed apps have no stdout)
//   relocate: "a/b"             copy the app into <tmp>/a/b first (spaces, non-ASCII paths)
//   crashLog: "text"            the app must write crash.log containing text (user data folder)
//   launch: "open"              macOS: start through LaunchServices like Finder (no exit code)
//   os: {windows: {...}, macos: {...}}   per-OS overrides of the keys above

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isDeepStrictEqual } = require('util');

const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';

function readManifest(app) {
  for (const rel of ['Contents/Resources/manifest.json', '_internal/manifest.json']) {
    const m = path.join(app, ...rel.split('/'));
    if (fs.existsSync(m)) return JSON.parse(fs.readFileSync(m, 'utf8'));
  }
  throw new Error(`${app}: no dropring-pack manifest found`);
}

/**
 * Recursive copy that keeps symlinks. Deliberately not fs.cpSync: its native implementation in
 * recent Node versions crashed the whole process on Windows for non-ASCII paths (seen in CI).
 */
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else if (ent.isDirectory()) copyTree(from, to);
    else {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode);
    }
  }
}

/** The app folder or .app bundle for an app path or its executable. */
function appRootOf(p) {
  if (!fs.statSync(p).isFile()) return p;
  const dir = path.dirname(p);
  if (path.basename(dir) === 'MacOS' && path.basename(path.dirname(dir)) === 'Contents') return path.dirname(path.dirname(dir));
  return dir;
}

function userDataDir(name) {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name);
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), name);
}

function lastJsonLine(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return JSON.parse(lines[lines.length - 1]);
}

function merge(expected) {
  const { os: perOs, ...base } = expected;
  const extra = (perOs && perOs[OS]) || {};
  const out = { ...base, ...extra };
  for (const key of ['stdoutJson', 'outputJson']) if (base[key] || extra[key]) out[key] = { ...(base[key] || {}), ...(extra[key] || {}) };
  return out;
}

function subset(label, actual, expected, problems) {
  for (const [k, v] of Object.entries(expected)) {
    if (!isDeepStrictEqual(actual[k], v)) problems.push(`${label}.${k} = ${JSON.stringify(actual[k])}, expected ${JSON.stringify(v)}`);
  }
}

function runOnce(expected, exe, appPath, manifest) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dropring-pack-run-'));
  const outFile = path.join(cwd, 'fixture-output.json');
  const env = { ...process.env, DROPRING_PACK_NO_DIALOGS: '1', ...(expected.env || {}) };
  if (expected.outputFile) env.DRP_FIXTURE_OUT = outFile;
  const crashLog = path.join(userDataDir(manifest.app.name), 'crash.log');
  fs.rmSync(crashLog, { force: true });
  const t0 = process.hrtime.bigint();
  let r;
  if (expected.launch === 'open' && process.platform === 'darwin') {
    const stdoutFile = path.join(cwd, 'stdout.txt');
    const stderrFile = path.join(cwd, 'stderr.txt');
    const envArgs = ['DROPRING_PACK_NO_DIALOGS=1', ...(expected.outputFile ? [`DRP_FIXTURE_OUT=${outFile}`] : [])].flatMap((v) => ['--env', v]);
    r = spawnSync('/usr/bin/open', ['-W', '-n', ...envArgs, '--stdout', stdoutFile, '--stderr', stderrFile, appPath, ...(expected.args && expected.args.length ? ['--args', ...expected.args] : [])], { encoding: 'utf8', timeout: 120000 });
    r = { ...r, stdout: fs.existsSync(stdoutFile) ? fs.readFileSync(stdoutFile, 'utf8') : '', stderr: fs.existsSync(stderrFile) ? fs.readFileSync(stderrFile, 'utf8') : r.stderr, viaOpen: true };
  } else {
    r = spawnSync(exe, expected.args || [], { env, cwd, encoding: 'utf8', input: expected.stdin, timeout: 120000, windowsHide: true });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const problems = [];
  if (r.error) problems.push(`failed to start: ${r.error.message}`);
  if (r.signal) problems.push(`killed by signal ${r.signal}`);
  if (r.viaOpen) { if (r.status !== 0) problems.push(`open exited with ${r.status}: ${r.stderr}`); }
  else if (expected.exitCode !== undefined && r.status !== expected.exitCode) problems.push(`exit code ${r.status}, expected ${expected.exitCode}`);
  const stdout = (r.stdout || '').replace(/\r\n/g, '\n');
  if (expected.stdout !== undefined && stdout.trim() !== expected.stdout) problems.push(`stdout ${JSON.stringify(stdout.trim())}, expected ${JSON.stringify(expected.stdout)}`);
  if (expected.stderr !== undefined && !(r.stderr || '').includes(expected.stderr)) problems.push(`stderr does not contain ${JSON.stringify(expected.stderr)}`);
  if (expected.stdoutJson) {
    try { subset('stdout', lastJsonLine(stdout), expected.stdoutJson, problems); } catch (e) { problems.push(`stdout is not JSON: ${e.message}`); }
  }
  if (expected.outputJson) {
    try { subset('output', JSON.parse(fs.readFileSync(outFile, 'utf8')), expected.outputJson, problems); } catch (e) { problems.push(`no output file: ${e.message}`); }
  }
  if (expected.crashLog) {
    const text = fs.existsSync(crashLog) ? fs.readFileSync(crashLog, 'utf8') : null;
    if (text === null) problems.push(`crash.log was not written (${crashLog})`);
    else if (!text.includes(expected.crashLog)) problems.push(`crash.log does not contain ${JSON.stringify(expected.crashLog)}`);
    fs.rmSync(path.dirname(crashLog), { recursive: true, force: true });
  }
  fs.rmSync(cwd, { recursive: true, force: true });
  return { problems, ms, stdout, stderr: r.stderr || '' };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const repeat = Math.max(1, Number(flag('--repeat') || 1));
  const json = args.includes('--json') && args.splice(args.indexOf('--json'), 1);
  const [fixtureDir, app] = args;
  if (!fixtureDir || !app) throw new Error('usage: run-fixture.js <fixture-dir> <app> [--repeat N] [--json]');
  const expected = merge(JSON.parse(fs.readFileSync(path.join(fixtureDir, 'expected.json'), 'utf8')));
  let appPath = appRootOf(path.resolve(app));
  const manifest = readManifest(appPath);
  let relocatedRoot = null;
  if (expected.relocate) {
    relocatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dropring-pack-reloc-'));
    const dest = path.join(relocatedRoot, ...expected.relocate.split('/'), path.basename(appPath));
    copyTree(appPath, dest);
    appPath = dest;
  }
  const exe = path.join(appPath, ...manifest.app.executable.split('/'));
  const times = [];
  let last;
  for (let i = 0; i < repeat; i++) {
    last = runOnce(expected, exe, appPath, manifest);
    times.push(last.ms);
    if (last.problems.length) break;
  }
  if (relocatedRoot) fs.rmSync(relocatedRoot, { recursive: true, force: true });
  const sorted = [...times].sort((a, b) => a - b);
  const result = {
    fixture: path.basename(path.resolve(fixtureDir)),
    executable: exe,
    ok: last.problems.length === 0,
    problems: last.problems,
    runs: times.length,
    firstMs: Math.round(times[0]),
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
    stdout: last.stdout.trim().slice(0, 4000),
    stderr: last.stderr.trim().slice(0, 4000),
  };
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.fixture} (${exe})`);
    console.log(`  runs ${result.runs}, first ${result.firstMs} ms, median ${result.medianMs} ms`);
    if (!result.ok) {
      for (const p of result.problems) console.log(`  - ${p}`);
      console.log(`  stdout: ${result.stdout}\n  stderr: ${result.stderr}`);
    }
  }
  process.exitCode = result.ok ? 0 : 1;
}

try { main(); } catch (e) { console.error(e.message); process.exitCode = 2; }
