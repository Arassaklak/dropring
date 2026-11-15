# ADR-0003: Python runtime from python-build-standalone, pinned by hash

Status: accepted (M0)

## Context

Apps need a relocatable CPython for every target, obtainable from any build host, identical in
behaviour across Windows and macOS. Options: python.org installers/embeddable zips, conda,
building CPython ourselves, or python-build-standalone (PBS, maintained by Astral).

## Decision

Use PBS `install_only_stripped.tar.gz` archives. `runtime/runtimes.json` pins, per Python minor
version, the exact PBS release, CPython version and SHA-256 of each target archive (taken from the
release's `SHA256SUMS` and cross-checked with the GitHub API `digest`). `scripts/update-runtimes.js`
regenerates the file from a release tag.

- Supported: 3.10–3.15. Default: **3.14** (newest minor with a year of wheel coverage; 3.15.0 is a
  few weeks old and many binary packages do not ship 3.15 wheels yet). Planned (M2): `--python auto`
  picks the newest minor for which every resolved dependency has wheels on every requested target.
- 3.10 is end-of-life and was dropped by PBS after release `20261009`; it is pinned to that
  release (3.10.22), has no Windows arm64 build, and the builder prints an EOL warning.
- Downloads go to a content-addressed cache (`<cache>/downloads/<sha256>/`), are verified before
  use, and are extracted atomically (`<cache>/runtimes/<sha256>/`). `DROPRING_PACK_OFFLINE=1`
  forbids network access; a local mirror can be set with `DROPRING_PACK_RUNTIME_MIRROR`.
- Trimming is an explicit allow/deny list in `builder/strip.js` (headers, `bin/`, `Scripts/`,
  `libs/`, pip/ensurepip, idlelib, tests, `_test*` extension modules, man pages; Tcl/Tk only when
  tkinter is used).

## Consequences

- One runtime family for all targets; Windows arm64 is available from 3.11.
- We depend on PBS asset naming (`cpython-<ver>+<release>-<triple>-<flavour>.tar.gz`); tests
  assert the layout we rely on (`python3XY.dll`, `lib/libpython3.XY.dylib`, `Lib/`, `DLLs/`).
- PBS `install_only` archives do not contain the licence texts of bundled components (OpenSSL,
  SQLite, libffi, Tcl/Tk, ...). M7 collects them from the matching `full` archive once per pin and
  stores them under `runtime/licenses/<release>/` so builds stay offline-capable.

## Rejected alternatives

- python.org embeddable zip: Windows only; macOS installers are not relocatable.
- Building CPython in CI: large maintenance cost for no user-visible gain.
- conda: heavy, different ABI conventions, licence questions for defaults channel.
