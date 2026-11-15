#!/usr/bin/env node
'use strict';
// CI driver for the fixture matrix. Same commands on every runner OS.
//
//   node tests/ci.js native --target win-x64 --python 3.14 --launcher-dir dist-launchers
//       build every fixture for the runner's own target, run it, report
//   node tests/ci.js cross-build --targets win-x64,mac-arm64 --launcher-dir dist-launchers --out cross
//       build every fixture for foreign targets (Linux host), pack each target as <out>/<target>.tar
//   node tests/ci.js run --target mac-arm64 --apps cross/mac-arm64
//       run fixtures against apps built elsewhere
//
// Results go to stdout and, on GitHub Actions, to the job summary.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { build } = require('../builder');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const fixtureNames = () => fs.readdirSync(FIXTURES).filter((n) => fs.existsSync(path.join(FIXTURES, n, 'expected.json'))).sort();
const appName = (fixture) => `DRP ${fixture}`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function buildFixtures(targets, { python, launcherDir, out }) {
  const rows = [];
  for (const fixture of fixtureNames()) {
    const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, fixture, 'expected.json'), 'utf8'));
    const t0 = Date.now();
    const result = await build({ entry: path.join(FIXTURES, fixture, expected.entry), targets, python, launcherDir, out, name: appName(fixture) }, (e) => {
      if (e.type === 'warning') console.log(`warning [${e.target || '-'}] ${e.message}`);
      if (e.type === 'stage' && e.stage === 'done') console.log(`built [${e.target}] ${e.message}`);
    });
    for (const a of result.artifacts) rows.push({ fixture, target: a.target, path: a.path, sizeMB: +(a.sizeBytes / 1048576).toFixed(1), files: a.fileCount, buildMs: Date.now() - t0 });
  }
  return rows;
}

function runFixture(fixture, appPath) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'run-fixture.js'), path.join(FIXTURES, fixture), appPath, '--repeat', '5', '--json'], { encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return { ok: false, problems: [`runner failed: ${r.stderr || r.stdout}`], firstMs: null, medianMs: null };
  }
}

function report(title, rows) {
  const header = '| fixture | target | python | result | size MB | files | first run ms | median ms |\n|---|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => `| ${r.fixture} | ${r.target} | ${r.python || ''} | ${r.ok ? 'pass' : `**FAIL**: ${(r.problems || []).join('; ').replace(/\|/g, '\\|')}`} | ${r.sizeMB ?? ''} | ${r.files ?? ''} | ${r.firstMs ?? ''} | ${r.medianMs ?? ''} |`);
  const md = `### ${title}\n\n${header}\n${lines.join('\n')}\n`;
  console.log(md);
  for (const r of rows) if (!r.ok && r.stdout !== undefined) console.log(`--- ${r.fixture} stdout:\n${r.stdout}\n--- stderr:\n${r.stderr}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  if (rows.some((r) => !r.ok) || !rows.length) process.exitCode = 1;
}

/** Finds the app for a fixture inside a target folder (Windows folder or .app bundle). */
function locateApp(dir, fixture) {
  for (const name of [`${appName(fixture)}.app`, appName(fixture)]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`no app for ${fixture} in ${dir}`);
}

async function main() {
  const cmd = process.argv[2];
  const launcherDir = arg('launcher-dir') && path.resolve(arg('launcher-dir'));
  if (cmd === 'native') {
    const target = arg('target');
    const python = arg('python');
    const out = path.resolve(arg('out', path.join(ROOT, 'out')));
    const built = await buildFixtures(target, { python, launcherDir, out });
    report(`native ${target}, Python ${python || 'default'}`, built.map((b) => ({ ...b, python, ...runFixture(b.fixture, b.path) })));
  } else if (cmd === 'cross-build') {
    const out = path.resolve(arg('out', path.join(ROOT, 'cross')));
    const targets = arg('targets');
    const built = await buildFixtures(targets, { python: arg('python'), launcherDir, out });
    for (const target of new Set(built.map((b) => b.target))) {
      // tar keeps the executable bits that zip-based artefact uploads would lose
      await require('tar').c({ file: path.join(out, `${target}.tar`), cwd: path.join(out, target), portable: true }, fs.readdirSync(path.join(out, target)));
      console.log(`packed ${target}.tar`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### cross-build on ${process.platform}-${process.arch}\n\n${built.map((b) => `- ${b.target} ${b.fixture}: ${b.sizeMB} MB, ${b.files} files`).join('\n')}\n\n`);
    }
  } else if (cmd === 'run') {
    const target = arg('target');
    const apps = path.resolve(arg('apps'));
    report(`apps built on another host, run on ${target}`, fixtureNames().map((fixture) => ({ fixture, target, ...runFixture(fixture, locateApp(apps, fixture)) })));
  } else {
    throw new Error('usage: ci.js native|cross-build|run ...');
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
