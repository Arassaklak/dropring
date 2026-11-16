'use strict';
// Source analysis: which files to bundle and which modules the app imports.
//
// Primary: builder/analyzer/analyze.py, run by a python-build-standalone interpreter of the
// *target's* Python minor version for this computer (`-I -S -B`), so the parser accepts exactly
// the app's syntax. It only parses files; user code is never imported or executed.
// Fallback (no runtime for this computer, or the analyzer failed): a conservative text scan.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { toPosix } = require('./util');
const { hostTriple } = require('./targets');

const ANALYZER = path.join(__dirname, 'analyzer', 'analyze.py');
const IMPORT_RE = /^[ \t]*(?:from[ \t]+(\.*[\w.]*)[ \t]+import\b|import[ \t]+([^\n#;]+))/gm;
const TK_MODULES = new Set(['tkinter', '_tkinter', 'turtle', 'idlelib', 'turtledemo']);
const TK_STRING_RE = /["'](?:tkinter|_tkinter|turtle)(?:\.[\w.]*)?["']/;
const SKIP_DIRS = new Set(['.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', 'env', '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.idea', '.vscode', 'node_modules', 'dist', 'build', '.eggs']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const ENTRY_CANDIDATES = ['__main__.py', 'main.py', 'app.py'];

/** Top-level module names imported by a source file (text scan, absolute imports only). */
function scanImports(source) {
  const names = new Set();
  for (const m of source.matchAll(IMPORT_RE)) {
    if (m[1] !== undefined) {
      if (!m[1].startsWith('.') && m[1]) names.add(m[1].split('.')[0]);
      continue;
    }
    for (const part of m[2].replace(/[()\\]/g, ' ').split(',')) {
      const name = part.trim().split(/\s+/)[0];
      if (/^[A-Za-z_][\w.]*$/.test(name || '')) names.add(name.split('.')[0]);
    }
  }
  return names;
}

/** Should a path inside a project tree be skipped? Returns a reason or null. */
function skipReason(name, isDir) {
  if (isDir) return SKIP_DIRS.has(name) || name.endsWith('.egg-info') ? 'tooling or cache folder' : null;
  if (SKIP_FILES.has(name) || /\.py[co]$/.test(name)) return 'cache or OS metadata file';
  if (name === '.env' || name.startsWith('.env.')) return 'environment file (may contain secrets)';
  return null;
}

async function listTree(root, exclude = []) {
  const out = [];
  const skipped = [];
  const visit = async (dir) => {
    for (const ent of (await fs.promises.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, ent.name);
      if (exclude.some((x) => path.resolve(x) === path.resolve(abs))) continue;
      const reason = skipReason(ent.name, ent.isDirectory());
      if (reason) { if (reason.startsWith('environment')) skipped.push(toPosix(path.relative(root, abs))); continue; }
      if (ent.isDirectory()) await visit(abs);
      else if (ent.isFile()) out.push(toPosix(path.relative(root, abs)));
    }
  };
  await visit(root);
  return { files: out, skipped };
}

/** Where the app is: mode, root folder, entry script, and the files of a project folder. */
async function locateSources(input, opts) {
  const abs = path.resolve(input);
  const stat = await fs.promises.stat(abs).catch(() => null);
  if (!stat) throw new Error(`not found: ${input}`);
  if (stat.isDirectory()) {
    const entry = opts.entry ? toPosix(opts.entry) : ENTRY_CANDIDATES.find((n) => fs.existsSync(path.join(abs, n)));
    if (!entry || !fs.existsSync(path.join(abs, entry))) throw new Error(`no entry script in ${input}: add one of ${ENTRY_CANDIDATES.join(', ')} or pass --entry`);
    const tree = await listTree(abs, opts.exclude);
    const warnings = tree.skipped.map((s) => `left out ${s} (environment files may contain secrets; use --include to add it on purpose)`);
    return { mode: 'project', root: abs, entry, treeFiles: tree.files, warnings };
  }
  if (!/\.pyw?$/i.test(abs)) throw new Error(`expected a .py file or a project folder: ${input}`);
  return { mode: 'file', root: path.dirname(abs), entry: path.basename(abs), treeFiles: null, warnings: [] };
}

function runAnalyzer(exe, request, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-I', '-S', '-B', '-X', 'utf8', ANALYZER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, signal });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`analyzer exited with ${code}: ${Buffer.concat(err).toString('utf8').trim().split('\n').slice(-3).join(' | ')}`));
      try { resolve(JSON.parse(Buffer.concat(out).toString('utf8'))); } catch (e) { reject(new Error(`analyzer output is not JSON: ${e.message}`)); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

async function astAnalysis(src, opts) {
  const { resolveRuntime, ensureRuntime } = require('./runtime');
  const triple = hostTriple();
  if (!triple) throw new Error(`no Python runtime is available for this computer (${process.platform}-${process.arch})`);
  const env = opts.processEnv || process.env;
  const spec = resolveRuntime(opts.python, { triple, label: `this computer (${triple})` }, env);
  const rt = await ensureRuntime(spec, { env, cacheDir: opts.cacheDir, signal: opts.signal, onProgress: opts.onProgress });
  const exe = process.platform === 'win32' ? path.join(rt.root, 'python.exe') : path.join(rt.root, 'bin', `python${spec.minor}`);
  const report = await runAnalyzer(exe, { root: src.root, mode: src.mode, entry: src.entry, hidden: opts.hiddenImports || [], exclude: opts.excludeModules || [] }, opts.signal);
  return { ...report, analyzer: 'ast' };
}

/** M0 text scan, kept as a fallback when the AST analyzer cannot run. */
async function textAnalysis(src, opts) {
  const modules = {};
  const files = new Set([src.entry]);
  const queue = [src.entry];
  let usesTkinter = false;
  const exclude = new Set((opts.excludeModules || []).map((m) => m.split('.')[0]));
  for (const h of opts.hiddenImports || []) modules[h.split('.')[0]] = { kind: 'required', category: 'unknown', where: '--hidden-import' };
  while (queue.length) {
    const rel = queue.shift();
    const source = await fs.promises.readFile(path.join(src.root, ...rel.split('/')), 'utf8');
    const names = scanImports(source);
    if ([...names].some((n) => TK_MODULES.has(n)) || TK_STRING_RE.test(source)) usesTkinter = true;
    for (const name of names) {
      if (exclude.has(name)) continue;
      if (!modules[name]) modules[name] = { kind: 'required', category: 'unknown', where: rel };
      if (fs.existsSync(path.join(src.root, `${name}.py`)) && !files.has(`${name}.py`)) {
        files.add(`${name}.py`);
        queue.push(`${name}.py`);
      } else if (fs.existsSync(path.join(src.root, name, '__init__.py')) && ![...files].some((f) => f.startsWith(`${name}/`))) {
        for (const f of (await listTree(path.join(src.root, name))).files) {
          files.add(`${name}/${f}`);
          if (f.endsWith('.py')) queue.push(`${name}/${f}`);
        }
      }
    }
  }
  for (const [name, m] of Object.entries(modules)) if (fs.existsSync(path.join(src.root, `${name}.py`)) || fs.existsSync(path.join(src.root, name))) m.category = 'local';
  return { python: null, files: [...files].sort(), modules, dynamic: [], syntaxErrors: [], warnings: [], gui: usesTkinter ? ['tkinter'] : [], usesTkinter, analyzer: 'text' };
}

/**
 * Works out what to bundle for an entry script or a project folder.
 * @param {string} input  path to a .py file or a project folder
 * @param {{entry?: string, exclude?: string[], python?: string, hiddenImports?: string[], excludeModules?: string[],
 *          processEnv?: NodeJS.ProcessEnv, cacheDir?: string, signal?: AbortSignal,
 *          onProgress?: (received: number, total: number|null) => void, textOnly?: boolean}} [opts]
 */
async function analyze(input, opts = {}) {
  const src = await locateSources(input, opts);
  const warnings = [...src.warnings];
  let report;
  if (opts.textOnly) report = await textAnalysis(src, opts);
  else {
    try {
      report = await astAnalysis(src, opts);
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      warnings.push(`AST analysis unavailable (${err.message}); used a simpler text scan`);
      report = await textAnalysis(src, opts);
    }
  }
  warnings.push(...report.warnings);
  return {
    mode: src.mode,
    root: src.root,
    entry: src.entry,
    files: src.mode === 'project' ? src.treeFiles : report.files,
    modules: report.modules,
    imports: Object.keys(report.modules).sort(),
    dynamic: report.dynamic,
    syntaxErrors: report.syntaxErrors,
    gui: report.gui,
    usesTkinter: report.usesTkinter,
    analyzer: report.analyzer,
    analyzerPython: report.python,
    warnings,
  };
}

module.exports = { analyze, scanImports, skipReason, listTree, ENTRY_CANDIDATES, ANALYZER };
