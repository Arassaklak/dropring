# ADR-0009: Third-party dependencies — sources, resolution, inference and verification

Status: accepted (M2)

## Context

M2 bundles third-party packages. The build host may be any OS, the app may target another, and
DropRing's typical input is a single dropped `.py` file without a requirements file. ADR-0004
chose uv for target-aware resolution; this ADR fixes the rest of the pipeline.

Verified before deciding (uv 0.13.5, 2026-11-16): from a Mac, `uv pip compile
--python-platform x86_64-pc-windows-msvc --python-version 3.14 --only-binary :all:
--generate-hashes` + `uv pip install --target ... --require-hashes --no-deps` installs the
Windows wheels (`cp314-win_amd64.pyd` for pydantic-core, PyYAML, markupsafe,
charset-normalizer); environment markers are evaluated for the target (tqdm gets
`colorama; platform_system == "Windows"` only for Windows); source-only packages fail with a
message naming the package; `uv export --script` reads PEP 723 metadata.

## Decision

1. **Sources, first match wins:** `--requirements FILE`; else the project's declared
   dependencies (`requirements.txt`, `pyproject.toml` `[project] dependencies` or Poetry
   `[tool.poetry.dependencies]`, `setup.cfg` `install_requires`, `Pipfile` `[packages]`, PEP 723
   block in the entry script); else **inference** from the analyzer's third-party imports.
   `--package SPEC` (repeatable) adds requirements explicitly; `--index-url`/`--extra-index-url`
   and `--find-links` pass through. No `setup.py` is ever executed.
2. **Inference is allow-listed.** An import becomes a requirement only through
   `hooks/import-names.json` (import name → distribution, e.g. `yaml → PyYAML`,
   `PIL → Pillow`, `cv2 → opencv-python`), a curated list of widely used packages. Any other
   unresolved third-party import is a build error that names the import and file:line and asks
   for a requirements file or `--package`. Guessing names from code would install whatever
   PyPI package has that name, which is a typosquatting risk (`import reqeusts`).
3. **Resolution per target** with `uv pip compile` (target triple, target Python version,
   `--only-binary :all:`, `--generate-hashes`), then **installation** with `uv pip install
   --target <app>/site-packages --require-hashes --no-deps`. uv is pinned and hash-checked
   like the runtimes; its cache lives in ours (`<cache>/uv`); `DROPRING_PACK_OFFLINE=1` maps to
   `--offline`.
4. **Verification:** every installed file is checked against its wheel's `RECORD` hash; every
   required third-party import must be provided by an installed distribution (its top-level
   names); otherwise the build fails. Wheels are installed whole (code, data, `.dist-info`), so
   package-internal dynamic imports, `importlib.resources`, `importlib.metadata.version()` and
   entry points work without per-package hooks. Console-script wrappers (`bin/`) and caches are
   dropped.
5. **Source-only packages** (no wheel for the target) are reported with package, version and
   reason, and three ways forward: a version that ships wheels, building on a matching runner
   (M3), or the fallback engine (M7). The app is not built.
6. **Hooks** (`hooks/*.json`, user hooks via `--hooks DIR`) describe what whole-wheel installs
   cannot know: standard-library needs of a package (`stdlib: ["tkinter"]` for customtkinter,
   ttkbootstrap, PySimpleGUI, matplotlib's Tk backend), runtime environment variables, platform
   notes, and later (M7) trimming of tests/docs inside big packages.
7. The manifest (SBOM) records every distribution: name, version, wheel file name, wheel
   SHA-256 and declared licence.

## Consequences

- Apps are larger than with import-level collection (whole wheels), but far less fragile; size
  trimming is M7 work driven by hooks and measurements.
- An unusual import name needs a requirements file or `--package`; DropRing will offer this in
  its UI (M6).
- Cross-target installs already work for wheel-only dependencies; M3 verifies native extensions
  load on every target and adds what is missing (DLL search paths, macOS signing of `.so` files).
