'use strict';
// Third-party dependencies (ADR-0009): decide what to install, resolve it for each target with
// uv (target platform + Python version, wheels only, hashes), install whole wheels into a
// staging site-packages, verify every file against its RECORD and that imports are provided.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const IMPORT_NAMES = require('../hooks/import-names.json').names;

const REQUIREMENTS_PY = path.join(__dirname, 'analyzer', 'requirements.py');
const INSTALL_KINDS = new Set(['required', 'deferred', 'conditional']);

/** PEP 503 name normalisation. */
const normalize = (name) => String(name).replace(/[-_.]+/g, '-').toLowerCase();

function run(exe, args, { input, env, signal, timeoutMs = 900000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env, signal, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
    child.stdin.end(input || '');
  });
}

/** Declared dependencies of the project (requirements.py, run by a Python 3.11+). */
async function readDeclared({ toolPython, analysis, signal }) {
  const r = await run(toolPython, ['-I', '-S', '-B', '-X', 'utf8', REQUIREMENTS_PY], {
    input: JSON.stringify({ root: analysis.root, entry: analysis.entry, mode: analysis.mode }), signal,
  });
  if (r.code !== 0) {
    let message = r.stderr.trim();
    try { message = JSON.parse(message).error; } catch { /* plain text */ }
    throw new Error(`cannot read the declared dependencies: ${message}`);
  }
  return JSON.parse(r.stdout);
}

/** Requirements inferred from third-party imports — only through the allow-list. */
function infer(analysis) {
  const specs = [];
  const used = [];
  const unknown = [];
  for (const [name, m] of Object.entries(analysis.modules || {})) {
    if (m.category !== 'third-party' || !INSTALL_KINDS.has(m.kind)) continue;
    const entry = IMPORT_NAMES[name];
    if (!entry) { unknown.push({ import: name, where: m.where, kind: m.kind }); continue; }
    const dist = typeof entry === 'string' ? entry : entry.dist;
    const marker = typeof entry === 'string' ? null : entry.marker;
    specs.push(marker ? `${dist}; ${marker}` : dist);
    used.push({ import: name, dist, where: m.where });
  }
  return { specs: [...new Set(specs)].sort(), used, unknown };
}

/**
 * What to install for this app.
 * @returns {Promise<{source: string|null, passthrough: string[], specs: string[], inferred: object[],
 *   unknown: object[], warnings: string[]}>}
 */
async function planDependencies({ analysis, requirements, packages = [], toolPython, signal }) {
  const plan = { source: null, passthrough: [], specs: [], inferred: [], unknown: [], warnings: [] };
  if (requirements) {
    const file = path.resolve(requirements);
    if (!fs.existsSync(file)) throw new Error(`--requirements ${requirements}: file not found`);
    plan.source = `--requirements ${path.basename(file)}`;
    plan.passthrough.push(file);
  } else if (analysis.analyzer === 'ast') {
    const declared = await readDeclared({ toolPython, analysis, signal });
    plan.warnings.push(...declared.warnings);
    if (declared.source) {
      plan.source = declared.source;
      if (declared.passthrough) plan.passthrough.push(declared.passthrough);
      plan.specs.push(...declared.requirements);
    }
  }
  if (!plan.source) {
    const inferred = infer(analysis);
    plan.inferred = inferred.used;
    plan.unknown = inferred.unknown;
    plan.specs.push(...inferred.specs);
    if (inferred.specs.length) plan.source = 'inferred from imports';
  }
  if (packages.length) {
    plan.specs.push(...packages);
    plan.source = plan.source ? `${plan.source} + --package` : '--package';
  }
  plan.specs = [...new Set(plan.specs)];
  return plan;
}

const hasWork = (plan) => plan.passthrough.length > 0 || plan.specs.length > 0;

/** Environment for uv: our cache, no user config, no interpreter downloads, no colours. */
function uvEnv(cacheDir, env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !/^UV_/i.test(k)));
  // PYTHONDONTWRITEBYTECODE: uv runs the cached interpreter to inspect it; keep it from writing .pyc files there.
  return { ...clean, UV_CACHE_DIR: path.join(cacheDir, 'uv'), UV_NO_CONFIG: '1', UV_PYTHON_DOWNLOADS: 'never', UV_NO_PROGRESS: '1', NO_COLOR: '1', PYTHONDONTWRITEBYTECODE: '1' };
}

function indexArgs({ indexUrl, extraIndexUrls = [], findLinks = [] }, env) {
  const args = [];
  if (indexUrl) args.push('--index-url', indexUrl);
  for (const u of extraIndexUrls) args.push('--extra-index-url', u);
  for (const f of findLinks) args.push('--find-links', f);
  if (env.DROPRING_PACK_OFFLINE === '1') args.push('--offline');
  return args;
}

function targetArgs(target, minor) {
  return ['--python-platform', target.triple, '--python-version', minor, '--only-binary', ':all:'];
}

/** Parses `uv pip compile --generate-hashes` output. */
function parseLock(text) {
  const pkgs = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?==([^\s;\\]+)/.exec(line);
    if (m) { pkgs.push({ name: m[1], version: m[3], hashes: [] }); continue; }
    const h = /--hash=sha256:([0-9a-f]{64})/.exec(line);
    if (h && pkgs.length) pkgs[pkgs.length - 1].hashes.push(h[1]);
  }
  return pkgs;
}

/** Shortens uv's resolver message to the lines that explain the problem. */
function uvReason(stderr) {
  const lines = stderr.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() && !/^\s*(hint|help):\s*$/.test(l));
  return lines.slice(0, 8).join('\n    ');
}

class DependencyError extends Error {
  constructor(message, problems) {
    super(message);
    this.name = 'DependencyError';
    this.code = 'DEPENDENCIES_FAILED';
    this.problems = problems;
  }
}

/**
 * Resolves the plan for one target; on failure finds out which direct requirement is the cause.
 * @returns {Promise<{lockFile: string, packages: {name: string, version: string, hashes: string[]}[]}>}
 */
async function resolve({ uv, plan, target, minor, workDir, options, env, signal }) {
  await fs.promises.mkdir(workDir, { recursive: true });
  const lockFile = path.join(workDir, 'requirements.lock');
  // Requirements files are passed to uv as arguments, never as "-r <path>" lines: inside a
  // requirements file a Windows path loses its backslashes ("D:\a\x" became "d:ax", which uv
  // then took for a URL), and relative includes in the user's file must resolve from its folder.
  const inputs = [...plan.passthrough];
  if (plan.specs.length) {
    const specsFile = path.join(workDir, 'requirements.in');
    await fs.promises.writeFile(specsFile, plan.specs.join('\n') + '\n');
    inputs.push(specsFile);
  }
  const common = [...targetArgs(target, minor), ...indexArgs(options, env), '--no-header', '--no-annotate', '--quiet'];
  const r = await run(uv, ['pip', 'compile', ...inputs, '-o', lockFile, '--generate-hashes', ...common], { env, signal });
  if (r.code === 0) return { lockFile, packages: parseLock(await fs.promises.readFile(lockFile, 'utf8')) };

  // Find the culprit(s): resolve each direct requirement (and each requirements file) on its own.
  const problems = [];
  const singles = [...plan.passthrough.map((file) => ({ label: `requirements file ${path.basename(file)}`, file })), ...plan.specs.map((spec) => ({ label: spec, spec }))];
  for (const one of singles) {
    let input = one.file;
    if (!input) {
      input = path.join(workDir, 'one.in');
      await fs.promises.writeFile(input, one.spec + '\n');
    }
    const s = await run(uv, ['pip', 'compile', input, ...common], { env, signal });
    if (s.code !== 0) problems.push(`${one.label}: ${uvReason(s.stderr)}`);
  }
  if (!problems.length) problems.push(`the requirements conflict with each other: ${uvReason(r.stderr)}`);
  const hint = `Options: pick a version that ships wheels for ${target.label} and Python ${minor}, build with another --python (3.14 has the widest wheel coverage today), or drop ${target.id}.`;
  throw new DependencyError(`dependencies cannot be installed for ${target.label} (Python ${minor}):\n  - ${problems.join('\n  - ')}\n  ${hint}`, problems);
}

/** Installs the resolved lock into `siteDir` (whole wheels, hash-checked, copied not linked). */
async function install({ uv, lockFile, siteDir, python, target, minor, options, env, signal }) {
  const args = ['pip', 'install', '--target', siteDir, '--python', python, ...targetArgs(target, minor),
    ...indexArgs(options, env), '--require-hashes', '--no-deps', '--link-mode', 'copy', '--quiet', '-r', lockFile];
  const r = await run(uv, args, { env, signal });
  if (r.code !== 0) throw new DependencyError(`installing dependencies for ${target.label} failed:\n    ${uvReason(r.stderr)}`, [r.stderr]);
}

function parseMetadata(text) {
  const headers = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) break; // headers end at the first blank line
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m && !(m[1] in headers)) headers[m[1]] = m[2];
  }
  return headers;
}

/**
 * Verifies RECORD hashes, removes console-script wrappers and caches, and lists what each
 * distribution provides.
 */
async function verifyAndClean(siteDir) {
  await fs.promises.rm(path.join(siteDir, 'bin'), { recursive: true, force: true });
  await fs.promises.rm(path.join(siteDir, 'Scripts'), { recursive: true, force: true });
  const distributions = [];
  const provided = new Set();
  for (const entry of (await fs.promises.readdir(siteDir)).sort()) {
    if (!entry.endsWith('.dist-info')) continue;
    const info = path.join(siteDir, entry);
    const meta = parseMetadata(await fs.promises.readFile(path.join(info, 'METADATA'), 'utf8'));
    const wheel = parseMetadata(await fs.promises.readFile(path.join(info, 'WHEEL'), 'utf8').catch(() => ''));
    const record = await fs.promises.readFile(path.join(info, 'RECORD'), 'utf8');
    const tops = new Set();
    let files = 0;
    for (const line of record.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [rel, hash] = line.split(',');
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue; // scripts outside the target
      const first = rel.split('/')[0];
      if (!hash) continue; // RECORD itself, signatures
      if (first === 'bin' || first === 'Scripts') continue; // console-script wrappers, removed above
      const file = path.join(siteDir, ...rel.split('/'));
      if (!fs.existsSync(file)) {
        if (/\.pyc$/.test(rel)) continue;
        throw new DependencyError(`${meta.Name} ${meta.Version}: ${rel} listed in RECORD is missing`, [rel]);
      }
      const [algo, expected] = hash.split('=');
      if (algo !== 'sha256') throw new DependencyError(`${meta.Name}: unsupported RECORD hash ${algo} for ${rel}`, [rel]);
      const actual = crypto.createHash('sha256').update(await fs.promises.readFile(file)).digest('base64url');
      if (actual !== expected) throw new DependencyError(`${meta.Name} ${meta.Version}: ${rel} does not match its RECORD hash`, [rel]);
      files++;
      if (first.endsWith('.dist-info') || first.endsWith('.data')) continue;
      if (rel.includes('/')) tops.add(first);
      else if (/\.(py|pyd|so)$/.test(first)) tops.add(first.split('.')[0]);
    }
    for (const t of tops) provided.add(t);
    distributions.push({
      name: meta.Name, version: meta.Version, tag: wheel.Tag || null,
      license: meta['License-Expression'] || meta.License || null, files, topLevel: [...tops].sort(),
    });
  }
  const caches = [];
  const findCaches = async (dir) => {
    for (const ent of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const p = path.join(dir, ent.name);
      if (ent.name === '__pycache__') caches.push(p); else await findCaches(p);
    }
  };
  await findCaches(siteDir);
  for (const c of caches) await fs.promises.rm(c, { recursive: true, force: true });
  return { distributions, provided };
}

/**
 * Third-party imports of the app that no installed distribution provides.
 * @param {object} analysis
 * @param {Set<string>} provided  top-level names provided by installed distributions
 * @param {{python: string, declared: boolean}} ctx  declared = the project lists its dependencies
 */
function missingImports(analysis, provided, { python, declared }) {
  const { missingReason } = require('./checks');
  const errors = [];
  const warnings = [];
  for (const [name, m] of Object.entries(analysis.modules || {})) {
    if (m.category !== 'third-party' || m.kind === 'typing' || provided.has(name)) continue;
    const removed = missingReason(name, python);
    let msg;
    if (removed) msg = `${m.where}: ${removed}`;
    else if (declared) msg = `${m.where}: imports ${name}, but none of the declared dependencies provides it; add the right distribution to your requirements`;
    else msg = `${m.where}: imports ${name}, which is not a standard-library module and not on dropring-pack's list of known packages; add a requirements.txt (or --package <distribution>) so the right package is installed`;
    if (m.kind === 'required') errors.push(`${msg}. Use --exclude-module ${name} if the import is never reached`);
    else warnings.push(`${msg} (the import is ${m.kind}, so the app may still start)`);
  }
  return { errors, warnings };
}

module.exports = {
  planDependencies, hasWork, infer, resolve, install, verifyAndClean, missingImports, uvEnv, parseLock, parseMetadata, normalize, DependencyError,
};
