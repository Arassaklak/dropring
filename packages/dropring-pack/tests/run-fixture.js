#!/usr/bin/env node
'use strict';
// Runs a built app against a fixture's expected.json and reports wall-clock start-to-exit time.
//
//   node tests/run-fixture.js <fixture-dir> <app> [--repeat N] [--json]
//
// <app> is a .app bundle, a Windows app folder, or the executable itself. The app runs from a
// neutral working directory so it cannot depend on the caller's cwd.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isDeepStrictEqual } = require('util');

function findExecutable(app) {
  if (fs.statSync(app).isFile()) return app;
  for (const rel of ['Contents/Resources/manifest.json', '_internal/manifest.json']) {
    const m = path.join(app, ...rel.split('/'));
    if (fs.existsSync(m)) return path.join(app, ...JSON.parse(fs.readFileSync(m, 'utf8')).app.executable.split('/'));
  }
  throw new Error(`${app}: no dropring-pack manifest found`);
}

function lastJsonLine(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return JSON.parse(lines[lines.length - 1]);
}

function check(expected, r) {
  const problems = [];
  if (r.error) problems.push(`failed to start: ${r.error.message}`);
  if (r.signal) problems.push(`killed by signal ${r.signal}`);
  if (r.status !== expected.exitCode) problems.push(`exit code ${r.status}, expected ${expected.exitCode}`);
  const stdout = (r.stdout || '').replace(/\r\n/g, '\n');
  if (expected.stdout !== undefined && stdout.trim() !== expected.stdout) problems.push(`stdout ${JSON.stringify(stdout.trim())}, expected ${JSON.stringify(expected.stdout)}`);
  if (expected.stderr !== undefined && !(r.stderr || '').includes(expected.stderr)) problems.push(`stderr does not contain ${JSON.stringify(expected.stderr)}`);
  if (expected.stdoutJson) {
    let actual;
    try { actual = lastJsonLine(stdout); } catch (e) { problems.push(`stdout is not JSON: ${e.message}`); }
    if (actual) {
      for (const [k, v] of Object.entries(expected.stdoutJson)) {
        if (!isDeepStrictEqual(actual[k], v)) problems.push(`${k} = ${JSON.stringify(actual[k])}, expected ${JSON.stringify(v)}`);
      }
    }
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const repeat = Math.max(1, Number(flag('--repeat') || 1));
  const json = args.includes('--json') && args.splice(args.indexOf('--json'), 1);
  const [fixtureDir, app] = args;
  if (!fixtureDir || !app) throw new Error('usage: run-fixture.js <fixture-dir> <app> [--repeat N] [--json]');
  const expected = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'expected.json'), 'utf8'));
  const exe = findExecutable(path.resolve(app));
  const env = { ...process.env, ...(expected.env || {}) };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dropring-pack-run-'));
  const times = [];
  let problems = [];
  let last;
  for (let i = 0; i < repeat; i++) {
    const t0 = process.hrtime.bigint();
    last = spawnSync(exe, expected.args || [], { env, cwd, encoding: 'utf8', timeout: 120000, windowsHide: true });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    problems = check(expected, last);
    if (problems.length) break;
  }
  fs.rmSync(cwd, { recursive: true, force: true });
  const sorted = [...times].sort((a, b) => a - b);
  const result = {
    fixture: path.basename(path.resolve(fixtureDir)),
    executable: exe,
    ok: problems.length === 0,
    problems,
    runs: times.length,
    firstMs: Math.round(times[0]),
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
    stdout: (last.stdout || '').trim().slice(0, 4000),
    stderr: (last.stderr || '').trim().slice(0, 4000),
  };
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.fixture} (${exe})`);
    console.log(`  runs ${result.runs}, first ${result.firstMs} ms, median ${result.medianMs} ms`);
    if (!result.ok) {
      for (const p of problems) console.log(`  - ${p}`);
      console.log(`  stdout: ${result.stdout}\n  stderr: ${result.stderr}`);
    }
  }
  process.exitCode = result.ok ? 0 : 1;
}

try { main(); } catch (e) { console.error(e.message); process.exitCode = 2; }
