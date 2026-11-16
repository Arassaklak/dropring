'use strict';
// Runtime trimming: which files of a python-build-standalone runtime go into an app.
// The rules are an explicit, documented deny list over paths relative to the runtime's
// `python/` folder (forward slashes). Everything not denied is kept.

/**
 * @param {{os: 'windows'|'macos', minor: string, keepTkinter: boolean}} opts
 * @returns {(rel: string) => string|null}  returns the reason a path is dropped, or null to keep it
 */
function runtimeFilter({ os, minor, keepTkinter }) {
  const stdlib = os === 'windows' ? 'Lib' : `lib/python${minor}`;
  /** @type {[RegExp, string][]} */
  const rules = [];
  const deny = (re, why) => rules.push([re, why]);

  // Not needed at runtime: the launcher embeds the shared library, apps are not built against it.
  if (os === 'windows') {
    deny(/^(Scripts|include|libs)(\/|$)/, 'development files');
    deny(/^pythonw?\.exe$/, 'interpreter executables (the launcher embeds python3XY.dll)');
    deny(/^DLLs\/_(test|ctypes_test)[^/]*\.pyd$/, 'CPython test extension modules');
    deny(/^Lib\/venv\/scripts\/nt\/[^/]+\.exe$/, 'venv launcher executables');
  } else {
    deny(/^(bin|include|share)(\/|$)/, 'interpreter executables, headers, man pages');
    deny(/^lib\/pkgconfig(\/|$)/, 'development files');
    deny(new RegExp(`^${esc(stdlib)}/config-[^/]+(/|$)`), 'static library and build configuration');
    deny(new RegExp(`^${esc(stdlib)}/lib-dynload/_test[^/]*\\.so$`), 'CPython test extension modules');
  }
  deny(/\.(a|lib|pdb)$/, 'static libraries and debug symbols');
  deny(new RegExp(`^${esc(stdlib)}/site-packages/.+`), 'pre-installed packages (pip); apps get their own site-packages');
  deny(new RegExp(`^${esc(stdlib)}/(ensurepip|idlelib|turtledemo|__phello__)(/|$)`), 'not used by applications');
  deny(new RegExp(`^${esc(stdlib)}/(.+/)?(test|tests|idle_test)(/|$)`), 'test suites');
  // Bytecode caches in the cached runtime depend on whatever ran from it (the analyzer, uv's
  // interpreter check, manual tests); copying them would make apps differ build to build.
  deny(/(^|\/)__pycache__(\/|$)/, 'bytecode caches (not reproducible; apps compile in memory)');

  if (!keepTkinter) {
    const why = 'Tcl/Tk is only bundled when the app imports tkinter';
    deny(new RegExp(`^${esc(stdlib)}/(tkinter(/|$)|turtle\\.py$)`), why);
    if (os === 'windows') {
      deny(/^tcl(\/|$)/, why);
      deny(/^DLLs\/(_tkinter\.pyd|tcl[^/]*\.dll|tk[^/]*\.dll|libtommath\.dll)$/, why);
    } else {
      deny(new RegExp(`^${esc(stdlib)}/lib-dynload/_tkinter[^/]*\\.so$`), why);
      deny(/^lib\/(tcl|tk|itcl|thread)[^/]*(\/|$)/, why);
      deny(/^lib\/libtcl[^/]*\.dylib$/, why);
      deny(/^lib\/libtk[^/]*\.dylib$/, why);
    }
  }

  return (rel) => {
    for (const [re, why] of rules) if (re.test(rel)) return why;
    return null;
  };
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { runtimeFilter };
