'use strict';
// Turns the analysis into build errors and warnings. Errors are things that would make the app
// fail on start; warnings are things that might fail later. Every message names file:line.
// Third-party imports are checked after installation (deps.missingImports), not here.

const WINDOWS_ONLY = new Set(['winreg', 'msvcrt', '_winapi', 'winsound', '_overlapped', 'nt', '_msi', 'msilib', '_wmi']);
const POSIX_ONLY = new Set(['fcntl', 'termios', 'tty', 'pty', 'pwd', 'grp', 'resource', 'posix', 'syslog', 'crypt', 'spwd', 'nis', '_posixsubprocess', '_posixshmem', 'readline', 'curses', '_curses', '_curses_panel', 'ossaudiodev']);
const REMOVED = {
  distutils: '3.12', imp: '3.12', asynchat: '3.12', asyncore: '3.12', smtpd: '3.12',
  aifc: '3.13', audioop: '3.13', cgi: '3.13', cgitb: '3.13', chunk: '3.13', crypt: '3.13', imghdr: '3.13', mailcap: '3.13',
  msilib: '3.13', nis: '3.13', nntplib: '3.13', ossaudiodev: '3.13', pipes: '3.13', sndhdr: '3.13', spwd: '3.13',
  sunau: '3.13', telnetlib: '3.13', uu: '3.13', xdrlib: '3.13', lib2to3: '3.13',
};
const minorOf = (v) => Number(String(v).split('.')[1]);

/** Why a module is missing, for messages: removed from the standard library, or not installed. */
function missingReason(name, python) {
  if (REMOVED[name] && minorOf(python) >= minorOf(REMOVED[name])) {
    return `${name} was removed from the standard library in Python ${REMOVED[name]}; build with --python 3.${minorOf(REMOVED[name]) - 1}, install a replacement, or stop using it`;
  }
  return null;
}

/** Target-independent problems. */
function checkAnalysis(analysis) {
  const errors = [];
  const warnings = [];
  for (const e of analysis.syntaxErrors || []) errors.push(`${e.where}: ${e.message} (the app could not start)`);
  for (const d of analysis.dynamic || []) {
    warnings.push(`${d.where}: ${d.expression} cannot be resolved statically; if it loads a module, add --hidden-import <module> (or --package for a third-party one)`);
  }
  if (analysis.analyzer === 'text') warnings.push('imports were checked with a text scan only; missing modules are not detected');
  return { errors, warnings };
}

/** Modules that do not exist on the target OS. */
function checkTarget(analysis, target) {
  const errors = [];
  const warnings = [];
  const missing = target.os === 'windows' ? POSIX_ONLY : WINDOWS_ONLY;
  for (const [name, m] of Object.entries(analysis.modules || {})) {
    if (m.category !== 'stdlib' || !missing.has(name)) continue;
    const msg = `${m.where}: imports ${name}, which does not exist on ${target.label}`;
    if (m.kind === 'required') errors.push(`${msg}; the app would fail on start. Guard it (e.g. if sys.platform == ...) or drop ${target.id}`);
    else if (m.kind !== 'typing' && m.kind !== 'conditional') warnings.push(`${msg} (the import is ${m.kind})`);
  }
  return { errors, warnings };
}

function guiHint(analysis, windowed) {
  if (windowed !== undefined || !analysis.gui || !analysis.gui.length) return null;
  return `the app uses ${analysis.gui.join(', ')}: pass --windowed so Windows does not open a console window next to it (or --console to keep it and silence this hint)`;
}

module.exports = { checkAnalysis, checkTarget, guiHint, missingReason, WINDOWS_ONLY, POSIX_ONLY, REMOVED };
