'use strict';
// dropring-pack Node API.
//
//   const { build } = require('dropring-pack');
//   const { artifacts, manifest, warnings } = await build(
//     { entry: 'app.py', targets: ['win-x64', 'mac-arm64'], name: 'My App', out: 'dist', signal },
//     (event) => console.log(event),   // {type: 'stage'|'progress'|'warning'|'log', target?, ...}
//   );
//
// Stages: analyze, then per target resolve → fetch → assemble → brand → sign → verify (→ zip).

const fs = require('fs');
const path = require('path');
const { parseTargets, TARGETS, hostTargetId } = require('./targets');
const { analyze } = require('./analyze');
const { resolveRuntime, ensureRuntime, listRuntimes, MANIFEST } = require('./runtime');
const { findLauncher } = require('./launchers');
const { assembleOnedir } = require('./assemble');
const { cacheRoot } = require('./cache');
const { checkAnalysis, checkTarget, guiHint } = require('./checks');
const { resolveIncludes } = require('./include');
const { slug, sha256, throwIfAborted } = require('./util');

const VERSION = require('../package.json').version;

/** Options that are part of the CLI/API contract but not implemented yet, with their milestone. */
const PLANNED = { requirements: 'M2', hooks: 'M2', env: 'M2', trace: 'M5', fallback: 'M7' };

/**
 * @typedef {object} BuildOptions
 * @property {string} entry                 .py file or project folder
 * @property {string} [entryInProject]      entry script inside a project folder (default: __main__.py, main.py, app.py)
 * @property {string|string[]} [targets]    'win-x64', 'win-arm64', 'mac-arm64', 'mac-x64', 'host', 'all' (default: host)
 * @property {string} [name]                application name (default: script or folder name)
 * @property {string} [appId]               reverse-DNS identifier (default: local.dropring-pack.<name>)
 * @property {string} [version]             numeric version, e.g. 1.2.3 (default 1.0.0)
 * @property {'onedir'} [mode]              onefile arrives in M4
 * @property {boolean} [windowed]           GUI subsystem on Windows (no console); undefined = console + hint
 * @property {string} [python]              runtime minor version, e.g. '3.14' (default from runtimes.json)
 * @property {string} [icon]                .png, .ico, .icns or .svg (SVG needs sharp or @resvg/resvg-js)
 * @property {string} [company]             CompanyName in Windows version info
 * @property {string} [copyright]           LegalCopyright / NSHumanReadableCopyright
 * @property {string} [description]         FileDescription (default: name)
 * @property {boolean} [dpiAware]           Windows: per-monitor DPI-aware manifest
 * @property {string[]} [include]           extra data files, 'SRC=DEST'
 * @property {string[]} [hiddenImports]     modules to bundle although no import was found
 * @property {string[]} [excludeModules]    imports to ignore (never reached at runtime)
 * @property {string} [signCmd]             Windows: command template that signs the .exe ({file})
 * @property {boolean} [zip]                also write <name>-<version>-<target>.zip
 * @property {string} [out]                 output folder (default: dist)
 * @property {boolean} [flat]               single target only: put the app directly into `out`
 * @property {string} [launcherDir]         prebuilt launchers, <dir>/<target>/dropring-pack-<kind>[.exe]
 * @property {'adhoc'|'none'} [macSign]     default adhoc
 * @property {boolean} [utf8Mode]           run the app in Python UTF-8 mode (default true)
 * @property {string} [cacheDir]
 * @property {AbortSignal} [signal]
 * @property {NodeJS.ProcessEnv} [processEnv]  environment used instead of process.env (cache, offline, mirror)
 */

/**
 * Builds the app for every requested target.
 * @param {BuildOptions} options
 * @param {(event: object) => void} [onEvent]
 * @returns {Promise<{artifacts: object[], manifest: object[], warnings: object[]}>}
 */
async function build(options, onEvent = () => {}) {
  const o = { ...options };
  const env = o.processEnv || process.env;
  const warnings = [];
  const emit = (e) => {
    if (e.type === 'warning') warnings.push(e);
    try { onEvent(e); } catch { /* a faulty listener must not break the build */ }
  };
  for (const [key, milestone] of Object.entries(PLANNED)) {
    if (o[key] !== undefined && o[key] !== false && !(Array.isArray(o[key]) && !o[key].length)) {
      throw new Error(`option "${key}" is planned for ${milestone} and not implemented yet`);
    }
  }
  if (o.mode && o.mode !== 'onedir') throw new Error(`mode "${o.mode}" is planned for M4; only onedir is available`);
  if (!o.entry) throw new Error('entry (a .py file or project folder) is required');
  const targets = parseTargets(o.targets);
  if (o.flat && targets.length > 1) throw new Error('flat output needs exactly one target');
  const outDir = path.resolve(o.out || 'dist');
  const macSign = o.macSign || 'adhoc';
  if (!['adhoc', 'none'].includes(macSign)) throw new Error(`--mac-sign ${macSign}: identity signing is planned for M3; use adhoc or none`);
  if (o.signCmd && !targets.some((t) => t.os === 'windows')) throw new Error('--sign-cmd signs Windows executables; for macOS use --mac-sign');
  const version = o.version || '1.0.0';
  if (!/^\d+(\.\d+){0,3}$/.test(version) || version.split('.').some((p) => Number(p) > 65535)) {
    throw new Error(`version "${version}" must be numeric, like 1.2.3 (Windows and macOS require it)`);
  }
  const python = o.python || MANIFEST.default;
  const cacheDir = o.cacheDir || cacheRoot(env);

  emit({ type: 'stage', stage: 'analyze', message: `scanning ${o.entry}` });
  let lastPct = -1;
  const analysis = await analyze(o.entry, {
    entry: o.entryInProject, exclude: [outDir], python, hiddenImports: o.hiddenImports, excludeModules: o.excludeModules,
    processEnv: env, cacheDir, signal: o.signal,
    onProgress: (received, total) => {
      const pct = total ? Math.floor((received / total) * 100) : null;
      if (pct !== null && pct !== lastPct) { lastPct = pct; emit({ type: 'progress', stage: 'analyze', value: pct / 100, received, total, message: 'Python for the analyzer' }); }
    },
  });
  for (const message of analysis.warnings) emit({ type: 'warning', message });
  emit({ type: 'log', level: 'info', message: `${analysis.analyzer === 'ast' ? `AST analysis (Python ${analysis.analyzerPython})` : 'text scan'}: ${analysis.files.length} file(s), entry ${analysis.entry}, ${analysis.imports.length} imported module(s)${analysis.gui.length ? `, GUI: ${analysis.gui.join(', ')}` : ''}` });
  const general = checkAnalysis(analysis, { python });
  const perTarget = targets.map((t) => ({ t, ...checkTarget(analysis, t) }));
  const hint = guiHint(analysis, o.windowed);
  for (const message of [...general.warnings, ...(hint ? [hint] : [])]) emit({ type: 'warning', message });
  for (const { t, warnings: w } of perTarget) for (const message of w) emit({ type: 'warning', target: t.id, message });
  const errors = [...general.errors, ...perTarget.flatMap(({ t, errors: e }) => e.map((m) => `[${t.id}] ${m}`))];
  if (errors.length) {
    const err = new Error(`the app cannot be built as it is:\n  - ${errors.join('\n  - ')}`);
    err.code = 'ANALYSIS_FAILED';
    err.problems = errors;
    throw err;
  }

  const name = (o.name || defaultName(analysis)).trim();
  const appId = o.appId || `local.dropring-pack.${slug(name)}`;
  if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(appId)) throw new Error(`app id "${appId}" must be reverse-DNS, like com.example.myapp`);
  const app = {
    name, appId, version, windowed: !!o.windowed, utf8Mode: o.utf8Mode !== false,
    company: o.company, copyright: o.copyright, description: o.description, dpiAware: !!o.dpiAware,
  };
  const includes = await resolveIncludes(o.include, analysis.root);
  const icon = o.icon ? await prepareIcon(o.icon, targets, emit) : null;

  const artifacts = [];
  for (const target of targets) {
    throwIfAborted(o.signal);
    const tag = { target: target.id };
    emit({ type: 'stage', stage: 'resolve', ...tag, message: `Python ${python} for ${target.label}` });
    const runtime = resolveRuntime(python, target, env);
    if (runtime.endOfLife) emit({ type: 'warning', ...tag, message: `Python ${runtime.minor} is end-of-life and no longer receives security fixes; prefer 3.11 or newer` });

    emit({ type: 'stage', stage: 'fetch', ...tag, message: `Python ${runtime.version} (python-build-standalone ${runtime.release})` });
    lastPct = -1;
    const fetched = await ensureRuntime(runtime, {
      env,
      cacheDir,
      signal: o.signal,
      onProgress: (received, total) => {
        const pct = total ? Math.floor((received / total) * 100) : null;
        if (pct !== null && pct !== lastPct) { lastPct = pct; emit({ type: 'progress', stage: 'fetch', ...tag, value: pct / 100, received, total }); }
      },
    });
    emit({ type: 'log', level: 'info', ...tag, message: fetched.cached ? 'runtime from cache' : 'runtime downloaded and verified' });
    const launcher = await findLauncher(target, app.windowed ? 'windowed' : 'console', { launcherDir: o.launcherDir, env });

    const destDir = o.flat ? outDir : path.join(outDir, target.id);
    const artifact = await assembleOnedir({
      target, runtime, runtimeRoot: fetched.root, launcher, analysis, app, destDir, macSign, emit, signal: o.signal, env,
      icon: icon && { ico: target.os === 'windows' ? icon.ico() : null, icns: target.os === 'macos' ? icon.icns() : null, sha256: icon.sha256 },
      includes, signCmd: target.os === 'windows' ? o.signCmd : undefined, zip: !!o.zip,
    });
    emit({ type: 'stage', stage: 'done', ...tag, message: `${artifact.path} (${(artifact.sizeBytes / 1048576).toFixed(1)} MB, ${artifact.fileCount} files)` });
    artifacts.push(artifact);
  }
  const manifest = artifacts.map((a) => JSON.parse(fs.readFileSync(a.manifestPath, 'utf8')));
  return { artifacts, manifest, warnings };
}

/** Loads the icon once and renders each native format at most once. */
async function prepareIcon(file, targets, emit) {
  const { loadIcon, makeIco, makeIcns } = require('./icons');
  const loaded = await loadIcon(path.resolve(file));
  for (const message of loaded.warnings) emit({ type: 'warning', message });
  let ico = loaded.ico;
  let icns = loaded.icns;
  return {
    sha256: sha256(await fs.promises.readFile(path.resolve(file))),
    ico: () => (ico || (ico = makeIco(loaded.image))),
    icns: () => (icns || (icns = makeIcns(loaded.image))),
    targets,
  };
}

function defaultName(analysis) {
  if (analysis.mode === 'project') return path.basename(analysis.root);
  const stem = analysis.entry.replace(/\.pyw?$/i, '');
  return ['main', 'app', '__main__'].includes(stem.toLowerCase()) ? path.basename(analysis.root) : stem;
}

module.exports = { build, listRuntimes, TARGETS, hostTargetId, VERSION };
