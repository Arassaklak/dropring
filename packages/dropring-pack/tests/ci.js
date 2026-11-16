#!/usr/bin/env node
'use strict';
// CI driver for the fixture matrix. Same commands on every runner OS.
//
//   node tests/ci.js native --target win-x64 --python 3.14 --launcher-dir dist-launchers
//       build every fixture for the runner's own target, check branding, run it, report
//   node tests/ci.js cross-build --targets win-x64,mac-arm64 --launcher-dir dist-launchers --out cross
//       build every fixture for foreign targets (Linux host) as zips (<out>/<target>/*.zip)
//   node tests/ci.js run --target mac-arm64 --zips cross/mac-arm64
//       unzip apps built elsewhere with the OS's own tool, check branding, run them
//
// Every app is branded (test icon, version 1.2.3, company, copyright), so every run also proves
// that the edited launcher still works. Results go to stdout and the GitHub job summary.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { build } = require('../builder');
const { writeTestIcon } = require('./test-icon');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const VERSION = '1.2.3';
const COMPANY = 'DropRing Tests';
const COPYRIGHT = '© 2026 DropRing contributors';
const fixtureNames = () => fs.readdirSync(FIXTURES).filter((n) => fs.existsSync(path.join(FIXTURES, n, 'expected.json'))).sort();
const expectedOf = (f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, f, 'expected.json'), 'utf8'));
const appName = (f) => (expectedOf(f).build && expectedOf(f).build.name) || `DRP ${f}`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function buildFixtures(targets, { python, launcherDir, out, zip }) {
  const icon = writeTestIcon(path.join(os.tmpdir(), `dropring-pack-test-icon-${process.pid}.png`));
  const rows = [];
  for (const fixture of fixtureNames()) {
    const expected = expectedOf(fixture);
    const t0 = Date.now();
    const result = await build({
      entry: path.join(FIXTURES, fixture, expected.entry), targets, python, launcherDir, out, zip,
      name: appName(fixture), version: VERSION, icon, company: COMPANY, copyright: COPYRIGHT,
      windowed: !!(expected.build && expected.build.windowed), include: expected.build && expected.build.include,
    }, (e) => {
      if (e.type === 'warning') console.log(`warning [${e.target || '-'}] ${e.message}`);
      if (e.type === 'stage' && e.stage === 'done') console.log(`built [${e.target}] ${e.message}`);
    });
    for (const a of result.artifacts) rows.push({ fixture, target: a.target, path: a.path, zipPath: a.zipPath, sizeMB: +(a.sizeBytes / 1048576).toFixed(1), files: a.fileCount, buildMs: Date.now() - t0 });
  }
  return rows;
}

/** Checks the branding with the operating system's own tools. Returns problems. */
async function checkBranding(appPath) {
  const problems = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(appPath, fs.existsSync(path.join(appPath, '_internal')) ? '_internal' : 'Contents/Resources', 'manifest.json'), 'utf8'));
  const exe = path.join(appPath, ...manifest.app.executable.split('/'));
  if (process.platform === 'win32' && exe.endsWith('.exe')) {
    const ps = `$v = (Get-Item -LiteralPath $env:DRP_EXE).VersionInfo; @{product=$v.ProductName; version=$v.FileVersion; company=$v.CompanyName; copyright=$v.LegalCopyright} | ConvertTo-Json -Compress`;
    const info = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, DRP_EXE: exe }, encoding: 'utf8' }));
    const want = { product: manifest.app.name, version: VERSION, company: COMPANY, copyright: COPYRIGHT };
    for (const [k, v] of Object.entries(want)) if (info[k] !== v) problems.push(`VersionInfo.${k} = ${JSON.stringify(info[k])}, expected ${JSON.stringify(v)}`);
    const { readBranding } = require('../builder/windows');
    const b = await readBranding(exe);
    if (b.iconSizes.length !== 7) problems.push(`icon sizes ${b.iconSizes.join(',')}, expected 7 sizes`);
  } else if (process.platform === 'darwin' && appPath.endsWith('.app')) {
    const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8' }));
    if (plist.CFBundleIconFile !== 'AppIcon') problems.push('Info.plist has no CFBundleIconFile');
    if (plist.CFBundleShortVersionString !== VERSION) problems.push(`CFBundleShortVersionString = ${plist.CFBundleShortVersionString}`);
    if (plist.NSHumanReadableCopyright !== COPYRIGHT) problems.push('NSHumanReadableCopyright missing');
    const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'drp-iconset-')) + '/AppIcon.iconset';
    const r = spawnSync('/usr/bin/iconutil', ['-c', 'iconset', '-o', iconset, path.join(appPath, 'Contents', 'Resources', 'AppIcon.icns')], { encoding: 'utf8' });
    if (r.status !== 0) problems.push(`iconutil rejected AppIcon.icns: ${r.stderr.trim()}`);
    else if (!fs.existsSync(path.join(iconset, 'icon_512x512@2x.png'))) problems.push('AppIcon.icns has no 1024 px image');
    fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
  }
  return problems;
}

function runFixture(fixture, appPath) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'run-fixture.js'), path.join(FIXTURES, fixture), appPath, '--repeat', '5', '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  try {
    return JSON.parse((r.stdout || '').trim().split('\n').pop());
  } catch {
    const how = r.error ? `could not start (${r.error.message})` : r.signal ? `killed by ${r.signal}` : `exited with ${r.status}${r.status > 255 || r.status < 0 ? ` (0x${(r.status >>> 0).toString(16)})` : ''}`;
    return { ok: false, problems: [`runner ${how}; stderr: ${(r.stderr || '').trim().slice(-800) || '(empty)'}; stdout: ${(r.stdout || '').trim().slice(-400) || '(empty)'}`], firstMs: null, medianMs: null };
  }
}

async function runAndCheck(fixture, appPath) {
  const run = runFixture(fixture, appPath);
  const branding = await checkBranding(appPath).catch((e) => [`branding check failed: ${e.message}`]);
  return { ...run, ok: run.ok && !branding.length, problems: [...(run.problems || []), ...branding] };
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

/** Unzips with the OS's own tool, which is what a user would do. */
function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'darwin') execFileSync('/usr/bin/ditto', ['-x', '-k', zip, dest]);
  else if (process.platform === 'win32') {
    // .NET's ZipFile honours the zip UTF-8 name flag and is fast. Not System32\tar.exe: it
    // converts names to the ANSI code page and skips entries like "içerik ✓.txt" ("empty or
    // unreadable filename"). Not Expand-Archive: it took minutes for six ~800-file apps.
    const ps = 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:DRP_ZIP, $env:DRP_DEST)';
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, DRP_ZIP: zip, DRP_DEST: dest } });
  } else execFileSync('unzip', ['-q', zip, '-d', dest]);
  const entries = fs.readdirSync(dest);
  if (entries.length !== 1) throw new Error(`${zip} should contain exactly one app folder, found ${entries.join(', ')}`);
  return path.join(dest, entries[0]);
}

async function main() {
  const cmd = process.argv[2];
  const launcherDir = arg('launcher-dir') && path.resolve(arg('launcher-dir'));
  if (cmd === 'native') {
    const target = arg('target');
    const python = arg('python');
    const out = path.resolve(arg('out', path.join(ROOT, 'out')));
    const built = await buildFixtures(target, { python, launcherDir, out });
    const rows = [];
    for (const b of built) rows.push({ ...b, python, ...(await runAndCheck(b.fixture, b.path)) });
    report(`native ${target}, Python ${python || 'default'}`, rows);
  } else if (cmd === 'cross-build') {
    const out = path.resolve(arg('out', path.join(ROOT, 'cross')));
    const built = await buildFixtures(arg('targets'), { python: arg('python'), launcherDir, out, zip: true });
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### cross-build on ${process.platform}-${process.arch}\n\n${built.map((b) => `- ${b.target} ${b.fixture}: ${b.sizeMB} MB, ${b.files} files, ${path.basename(b.zipPath)}`).join('\n')}\n\n`);
    }
  } else if (cmd === 'run') {
    const target = arg('target');
    const zips = path.resolve(arg('zips'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'drp-unzip-'));
    const rows = [];
    for (const fixture of fixtureNames()) {
      const zip = fs.readdirSync(zips).find((n) => n.startsWith(`${appName(fixture)}-${VERSION}-`) && n.endsWith('.zip'));
      if (!zip) { rows.push({ fixture, target, ok: false, problems: ['zip not found'] }); continue; }
      const appPath = unzip(path.join(zips, zip), path.join(work, fixture));
      rows.push({ fixture, target, ...(await runAndCheck(fixture, appPath)) });
    }
    report(`apps built on another host, unzipped and run on ${target}`, rows);
  } else {
    throw new Error('usage: ci.js native|cross-build|run ...');
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
