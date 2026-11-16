'use strict';
// Package hooks (ADR-0009): what installing whole wheels cannot know. Built-in hooks live in
// hooks/packages/*.json; users add their own with --hooks DIR (same format, theirs win).
//
//   { "schema": 1,
//     "package": "customtkinter",          distribution name (any spelling; normalised)
//     "stdlib": ["tkinter"],               standard-library parts to keep (Tcl/Tk is optional)
//     "env": {"KEY": "value"},             runtime defaults; --env on the command line wins
//     "targets": ["windows"],              only for these OSes or target ids (default: all)
//     "notes": "shown in the build log" }

const fs = require('fs');
const path = require('path');

const BUILTIN_DIR = path.join(__dirname, '..', 'hooks', 'packages');
const KEYS = new Set(['schema', 'package', 'stdlib', 'env', 'targets', 'notes']);
const STDLIB_OPTIONS = new Set(['tkinter']);
const normalize = (name) => String(name).replace(/[-_.]+/g, '-').toLowerCase();

function validate(hook, file) {
  const bad = (msg) => new Error(`hook ${file}: ${msg}`);
  if (!hook || typeof hook !== 'object' || Array.isArray(hook)) throw bad('must be a JSON object');
  for (const k of Object.keys(hook)) if (!KEYS.has(k)) throw bad(`unknown field "${k}" (known: ${[...KEYS].join(', ')})`);
  if (hook.schema !== 1) throw bad('"schema" must be 1');
  if (typeof hook.package !== 'string' || !hook.package) throw bad('"package" must be a distribution name');
  if (hook.stdlib !== undefined && (!Array.isArray(hook.stdlib) || hook.stdlib.some((s) => !STDLIB_OPTIONS.has(s)))) throw bad(`"stdlib" may contain: ${[...STDLIB_OPTIONS].join(', ')}`);
  if (hook.env !== undefined && (typeof hook.env !== 'object' || Object.values(hook.env).some((v) => typeof v !== 'string'))) throw bad('"env" must map names to strings');
  if (hook.targets !== undefined && (!Array.isArray(hook.targets) || hook.targets.some((t) => typeof t !== 'string'))) throw bad('"targets" must be a list of OS names or target ids');
  return hook;
}

function loadDir(dir) {
  const out = new Map();
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    let hook;
    try { hook = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`hook ${file}: ${e.message}`); }
    validate(hook, file);
    out.set(normalize(hook.package), { ...hook, file });
  }
  return out;
}

/** Built-in hooks plus the user's (user hooks replace built-in ones for the same package). */
function loadHooks(userDir) {
  const hooks = loadDir(BUILTIN_DIR);
  if (userDir) {
    const dir = path.resolve(userDir);
    if (!fs.existsSync(dir)) throw new Error(`--hooks ${userDir}: folder not found`);
    for (const [k, v] of loadDir(dir)) hooks.set(k, v);
  }
  return hooks;
}

/**
 * Hooks that apply to the installed distributions for a target.
 * @returns {{applied: object[], keepTkinter: boolean, env: Record<string, string>}}
 */
function applyHooks(hooks, distributions, target) {
  const applied = [];
  const env = {};
  let keepTkinter = false;
  for (const d of distributions) {
    const h = hooks.get(normalize(d.name));
    if (!h) continue;
    if (h.targets && !h.targets.includes(target.os) && !h.targets.includes(target.id)) continue;
    applied.push(h);
    if ((h.stdlib || []).includes('tkinter')) keepTkinter = true;
    Object.assign(env, h.env || {});
  }
  return { applied, keepTkinter, env };
}

module.exports = { loadHooks, applyHooks, validate, BUILTIN_DIR };
