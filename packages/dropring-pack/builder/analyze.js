'use strict';
// Source analysis (M0): a conservative text scan of import statements that finds the local
// modules an entry script needs and whether tkinter is used. It never executes user code.
// M1 replaces the scan with an AST analyzer run by the host's Python runtime with `-I`.

const fs = require('fs');
const path = require('path');
const { toPosix } = require('./util');

const IMPORT_RE = /^[ \t]*(?:from[ \t]+(\.*[\w.]*)[ \t]+import\b|import[ \t]+([^\n#;]+))/gm;
const TK_MODULES = new Set(['tkinter', '_tkinter', 'turtle', 'idlelib', 'turtledemo']);
const TK_STRING_RE = /["'](?:tkinter|_tkinter|turtle)(?:\.[\w.]*)?["']/;

const SKIP_DIRS = new Set(['.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', 'env', '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.idea', '.vscode', 'node_modules', 'dist', 'build', '.eggs']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const ENTRY_CANDIDATES = ['__main__.py', 'main.py', 'app.py'];

/** Top-level module names imported by a source file (absolute imports only). */
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

function usesTk(source, names) {
  for (const n of names) if (TK_MODULES.has(n)) return true;
  return TK_STRING_RE.test(source);
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

/**
 * Works out what to copy for an entry script or a project folder.
 * @param {string} input  path to a .py file or a project folder
 * @param {{entry?: string, exclude?: string[]}} [opts]  entry inside a folder; paths to leave out
 * @returns {Promise<{mode: 'file'|'project', root: string, entry: string, files: string[],
 *   imports: string[], usesTkinter: boolean, warnings: string[]}>}  paths relative to root
 */
async function analyze(input, opts = {}) {
  const abs = path.resolve(input);
  const stat = await fs.promises.stat(abs).catch(() => null);
  if (!stat) throw new Error(`not found: ${input}`);
  const warnings = [];
  const imports = new Set();
  let usesTkinter = false;
  const read = async (file) => {
    const source = await fs.promises.readFile(file, 'utf8');
    const names = scanImports(source);
    for (const n of names) imports.add(n);
    if (usesTk(source, names)) usesTkinter = true;
    return names;
  };

  if (stat.isDirectory()) {
    const entry = opts.entry ? toPosix(opts.entry) : ENTRY_CANDIDATES.find((n) => fs.existsSync(path.join(abs, n)));
    if (!entry || !fs.existsSync(path.join(abs, entry))) throw new Error(`no entry script in ${input}: add one of ${ENTRY_CANDIDATES.join(', ')} or pass --entry`);
    const { files, skipped } = await listTree(abs, opts.exclude);
    for (const s of skipped) warnings.push(`left out ${s} (environment files may contain secrets; use --include to add it on purpose)`);
    for (const f of files) if (f.endsWith('.py')) await read(path.join(abs, f));
    return { mode: 'project', root: abs, entry, files, imports: [...imports].sort(), usesTkinter, warnings };
  }

  if (!/\.pyw?$/i.test(abs)) throw new Error(`expected a .py file or a project folder: ${input}`);
  const root = path.dirname(abs);
  const files = new Set([path.basename(abs)]);
  const queue = [abs];
  while (queue.length) {
    const file = queue.shift();
    for (const name of await read(file)) {
      const mod = path.join(root, `${name}.py`);
      const pkg = path.join(root, name);
      if (fs.existsSync(mod) && !files.has(`${name}.py`)) {
        files.add(`${name}.py`);
        queue.push(mod);
      } else if (fs.existsSync(path.join(pkg, '__init__.py')) && ![...files].some((f) => f.startsWith(`${name}/`))) {
        const tree = await listTree(pkg, opts.exclude);
        for (const f of tree.files) {
          files.add(`${name}/${f}`);
          if (f.endsWith('.py')) queue.push(path.join(pkg, f));
        }
      }
    }
  }
  return { mode: 'file', root, entry: path.basename(abs), files: [...files].sort(), imports: [...imports].sort(), usesTkinter, warnings };
}

module.exports = { analyze, scanImports, skipReason, ENTRY_CANDIDATES };
