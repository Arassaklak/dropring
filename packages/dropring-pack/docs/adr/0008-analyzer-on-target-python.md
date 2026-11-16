# ADR-0008: Static analysis runs on a Python of the target's version, on the build host

Status: accepted (M1)

## Context

The builder must know which files and modules an app needs without running it (DESIGN §8: the
build never executes user code unless `--trace` is given). Parsing Python in JavaScript would
mean maintaining a parser for every syntax change (pattern matching, PEP 695 type parameters,
PEP 750 template strings, ...), and the answer depends on the Python version the app will run on:
`sys.stdlib_module_names` changes between minors (e.g. `distutils` is gone in 3.12, 26 modules in
3.13).

## Decision

`builder/analyzer/analyze.py` runs on the python-build-standalone interpreter of the **target's
minor version** for the **build host's** platform (the same pinned, hash-checked runtime the
builder downloads anyway; for a native build it is literally the same archive), with
`-I -S -B -X utf8`. It only calls `ast.parse` on files reachable from the entry script; it never
imports them. It reports, per top-level module, how it is imported (`required`, `conditional`,
`deferred`, `optional` (try/except ImportError), `typing` (TYPE_CHECKING)) and what it is
(`local`, `stdlib`, `third-party`), plus dynamic imports, syntax errors and GUI toolkits.

The builder turns that into errors (syntax errors; required third-party or removed modules;
required OS-specific modules missing on a target, e.g. `winreg` for macOS) and warnings
(everything optional or unresolvable, with file:line and the `--hidden-import` /
`--exclude-module` fix). If no runtime can run on the host, it falls back to the M0 text scan and
says so.

## Consequences

- Cross builds download the host's runtime as well (one extra archive per minor version, cached).
- Analysis results match exactly what the target interpreter accepts.
- Linux build hosts work, although Linux is not yet a target (`hostTriple()` covers Linux).
