# dropring-pack — design

Status: M3 · last reviewed 2026-11-16 · decisions are recorded as ADRs in [`adr/`](adr/) · progress and evidence in [STATUS.md](STATUS.md).

## 1. What it is

`dropring-pack` turns a Python entry script (or project folder) into a standalone application:
a Windows folder with `App.exe`, or a macOS `App.app`. It runs on Windows, macOS and Linux build
hosts, needs no Python on the build machine or the user's machine, and does not use PyInstaller
(PyInstaller/Nuitka are optional, clearly reported fallbacks, M7).

The core idea: **nothing is compiled on the user's machine.** Every native piece (the CPython
runtime, the launcher, third-party wheels) is prebuilt for the *target* and downloaded with pinned
SHA-256 hashes. The builder only analyses, downloads and assembles files. That is what makes
"build a Windows app on a Mac" possible for the common case (pure Python + packages with wheels).

## 2. Components

```
packages/dropring-pack/
  builder/   Node.js (CommonJS + JSDoc, no build step): CLI, API, analysis, fetch, assembly, signing
  launcher/  Rust, zero third-party crates: tiny native launcher, prebuilt per target in CI
  boot/      Python: bootstrap run before the user's code + `dropring_pack_runtime` helper module
  runtime/   runtimes.json: pinned python-build-standalone builds (URL + SHA-256 per target)
  hooks/     (M2) package hook database (YAML), user hooks via --hooks
  tests/     unit tests (node:test), fixtures with expected.json, CI matrix runner
```

| Piece | Source | How it gets to the build machine |
|---|---|---|
| CPython runtime | python-build-standalone (`install_only_stripped`) | download + SHA-256 check, content-addressed cache |
| Launcher | this repo (`launcher/`) | built in CI per target; M0 uses the CI artefact or a local `cargo build`; release assets with pinned hashes from M1 |
| Wheels (M2/M3) | PyPI | `uv pip install --python-platform <target>` into a staging dir, hashes verified |
| Signing tools | `codesign` (macOS host), `rcodesign` (other hosts, M3), `signtool`/`osslsigncode` (user-supplied) | pinned download or user's PATH |

## 3. Build pipeline

`analyze → resolve → fetch → assemble → brand → sign → verify`, each a reported stage
(`{type:'stage'|'progress'|'warning'|'log'}` events, `AbortSignal` honoured between steps).

1. **analyze** — entry file and project root; AST analysis (ADR-0008) run by a Python of the
   *target's* version on the build host with `-I -S -B`: it parses, never imports. Required
   third-party, removed or OS-missing modules and syntax errors stop the build with file:line;
   optional ones are warnings. Declared dependencies (requirements, PEP 621/Poetry/uv/PDM,
   PEP 723) arrive in M2.
2. **resolve** — pick the runtime (`--python`, default 3.14) for every target; M2+: resolve
   distributions for each target's marker environment.
3. **fetch** — runtimes (and later wheels/launchers) into the cache; refuse hash mismatches;
   `DROPRING_PACK_OFFLINE=1` uses the cache only.
4. **assemble** — copy the stripped runtime, user code, bootstrap and launcher into the layout
   below; write the launcher config, `._pth` (Windows) and `Info.plist` (macOS).
5. **brand** — icon (PNG/ICO/ICNS, SVG via sharp) rendered by a dependency-free PNG/ICO/ICNS
   toolkit; Windows version info, icon group and optional DPI-aware manifest via `resedit`;
   macOS `AppIcon.icns` + Info.plist keys. `--include SRC=DEST` adds data files.
6. **sign** — macOS: ad-hoc by default (`codesign` on macOS hosts, `rcodesign` on Linux/Windows);
   Windows: optional `--sign-cmd` template run *after* all PE edits (and after the onefile append).
7. **verify** — structural checks; `manifest.json` (SBOM) with SHA-256 of every file, runtime and
   launcher provenance. The build never executes user code unless `--trace` is given (M5+).

## 4. Output layout (onedir)

```
Windows                                   macOS
App/                                      App.app/Contents/
  App.exe          launcher (console        Info.plist, PkgInfo
                   or windowed variant)     MacOS/App            launcher
  _internal/                                Resources/
    dropring-pack.cfg  launcher config        dropring-pack.cfg
    python/            stripped runtime        python/            stripped runtime
      python314._pth   path + isolation        app/               user code + data
    app/               user code + data        site-packages/     (M2) dependencies
    site-packages/     (M2) dependencies       pack/              boot.py, helper module, app.json
    pack/              boot.py, helper,        manifest.json
                       app.json
    manifest.json
```

Onefile (M4, Windows; optional on macOS): launcher + payload appended as a PE overlay, extracted
on first start into `%LOCALAPPDATA%\DropRingPack\<app-id>\<payload-sha256>\` (macOS
`~/Library/Caches/DropRingPack/...`) with temp-dir + rename, a lock file, path-traversal and
symlink checks, and a hash check before use. Authenticode is applied after the append. On macOS
the payload never goes into a signed Mach-O; it stays in `Contents/Resources/`.

## 5. Launcher and runtime behaviour

**Model (ADR-0001): in-process embedding.** The launcher loads the bundled
`python3XY.dll` / `libpython3.XY.dylib` and calls the stable-ABI entry point `Py_Main` (Windows,
wide argv) / `Py_BytesMain` (POSIX). One process: correct taskbar/Dock identity and icon, firewall
prompts that name the app, native Ctrl+C/SIGINT behaviour, exact exit codes, inherited stdio.
`sys.executable` is the app itself. This deviates from the brief's "start with child-process"
recommendation; the reasons and the fallback are in ADR-0001.

Configuring the interpreter without the version-specific `PyConfig` struct:

- **Windows:** a `python3XY._pth` file next to the DLL (documented for embedded Python since 3.6;
  in 3.11+ `getpath.py` checks it next to the library first). It fixes `sys.path`, sets
  `home`/`sys.prefix` to the runtime folder, implies isolated mode and skips the registry. The
  launcher also passes `-I`, so no `PYTHON*` variable is read even before path calculation.
- **macOS/Linux:** `._pth` is only looked up next to the executable on POSIX (non-framework
  builds report no library path), and a data file in `Contents/MacOS` breaks code signing. So the
  launcher removes every `PYTHON*` variable from its environment, saves them hex-encoded in
  `DROPRING_PACK_SAVED_ENV`, sets `PYTHONHOME`, and passes `-s`. The bootstrap restores the saved
  variables, so child processes see the user's original environment.

Common flags: `-B` (never write `__pycache__`, required for signed bundles) and `-X utf8`
(consistent I/O encoding; matches the default of Python 3.15, PEP 686; `--no-utf8-mode` opts out).

**Bootstrap (`pack/boot.py`)** runs as the interpreter's script: restores the environment, sets
`sys.frozen = True` and `sys._dropring_pack = {base_dir, resource_dir, app_dir, version, ...}`,
builds `sys.path` as `[app, <stdlib>, site-packages (+ .pth processing)]`, sets `sys.argv[0]` to
the executable, answers multiprocessing child invocations (`--multiprocessing-fork` and the exact
`-c "from multiprocessing.resource_tracker import main..."` forms only — never arbitrary `-c`), then
executes the entry script as `__main__`. `dropring_pack_runtime` offers `resource_path(rel)`,
`is_frozen()`, `app_dir()`, `user_data_dir()`; it also works unfrozen.

**Windows specifics:** two launcher binaries (console, windowed; the windowed one never creates a
console). The Python DLL is loaded with `LOAD_WITH_ALTERED_SEARCH_PATH`, so `vcruntime140.dll`
resolves next to it; the launcher links the CRT statically and depends only on system DLLs. The
embedded manifest declares `asInvoker`, `longPathAware`, the UTF-8 active code page and supported
OS GUIDs (DPI awareness is set by branding, M1).

**macOS specifics:** the launcher is `Contents/MacOS/<App>`; everything else is in `Resources`
and nothing is written into the bundle at runtime (`-B`). The executable's file name is ASCII
(`Ünïcode Äpp` → `Unicode App`) because `codesign` cannot seal a bundle whose
`CFBundleExecutable` is not ASCII; bundle, menu and Dock names keep the full name. The bootstrap
points `TCL_LIBRARY`/`TK_LIBRARY` at the bundled Tcl/Tk. Every Mach-O is signed bottom-up
(ad-hoc default); Developer ID + `notarytool` are opt-in (M3/M7).

**Errors users can see:** in a GUI launch (windowed Windows app; macOS app started by
launchd, i.e. Finder/Dock/`open`) an unhandled exception is saved to `crash.log` in the user
data folder and shown in a native dialog (`MessageBoxW` / `CFUserNotificationDisplayAlert`); the
launcher does the same for its own start-up errors. `DROPRING_PACK_NO_DIALOGS=1` suppresses the
dialogs (CI, scripts).

## 6. Dependencies and cross-target wheels (M2 done; native-extension verification M3)

Implemented as decided in ADR-0009: declared sources first, allow-listed inference otherwise,
per-target `uv pip compile` (hashes) + `uv pip install --target --require-hashes --no-deps`,
RECORD verification, a provided-imports check, and JSON package hooks (`hooks/packages/`,
`--hooks`). The original plan follows.

Layered discovery, each layer logged: declared deps → AST imports (run by the host runtime) →
distribution metadata (`top_level.txt`, `RECORD`, markers) → hook database → optional `--trace`
→ unresolved dynamic imports reported as warnings with file:line and a suggested
`--hidden-import`. Installation for a foreign target uses **uv** (ADR-0004) with
`--python-platform <triple> --python-version X.Y --only-binary :all: --target <staging>`, because
uv evaluates environment markers for the *target* (pip's `--platform` evaluates them against the
host, e.g. drops `colorama; sys_platform == "win32"` when building for Windows on a Mac).
sdist-only packages are reported (package, version, reason) with three options: a version that has
wheels, building on a matching CI runner, or the fallback engine. No half-working app is written.

## 7. Determinism, SBOM, licences

Same inputs → byte-identical output: sorted traversal, normalised permissions, fixed mtimes
(`SOURCE_DATE_EPOCH`, else the runtime archive's own mtime), no timestamps in generated files,
deterministic zip entries (M1), launcher built with `/Brepro` and `--remap-path-prefix`.
`manifest.json` lists every file with size and SHA-256, the runtime (version, release, archive
hash), the launcher (version, hash) and the engine. M7 adds `THIRD_PARTY_LICENSES` assembled from
the runtime's licence files, each wheel's `*.dist-info/licenses`, and the launcher's (MIT).

## 8. Security

Static analysis only by default; `--trace` executes user code and says so loudly. HTTPS
downloads with pinned hashes; mismatches abort. Archive extraction rejects absolute paths, `..`
and links that leave the target. Launcher config paths are relative and checked the same way.
`--env` values are redacted in logs and manifests. Threat model: this is a distribution tool, not
a protection tool; bundled code is readable.

## 9. Antivirus and reputation hygiene

No packer/UPX, no in-memory PE loading, no injection, no anti-debug, no obfuscation. The launcher
is small, open source, reproducibly built from a pinned toolchain, and carries accurate version
info. Every launcher asset's SHA-256 is published and recorded in the app manifest. `docs/`
(M7) explains false-positive submission and why signing helps.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Embedding via `Py_Main` + `PYTHONHOME`/`._pth` behaves differently across 3.10 (C getpath) and 3.11+ (`getpath.py`) | CI matrix runs every supported minor on Windows and macOS; child-process launcher kept as fallback (ADR-0001) |
| PBS changes asset names/layout; 3.10 already dropped (last: `20261009`) | pins in `runtimes.json`, `scripts/update-runtimes.js`, layout assertions in tests |
| macOS notarization rejects Mach-O files under `Resources/` | M3 spike: move `.so/.dylib` to `Contents/Frameworks` with symlinks if notarization requires it |
| AV false positives on the shared launcher | reputation via signing, small honest binary, documentation; never pack |
| uv CLI changes | pin version + hashes; the wheel step sits behind one module |
| Newest npm/crate releases may be compromised | pin versions published ≥ 14 days earlier (e.g. resedit 3.1.0, not 3.1.1 from 2026-11-15) |

## 11. Milestones

| | Scope | Acceptance |
|---|---|---|
| M0 | runtime download+verify, Rust launcher, onedir assembly for the host and (pure Python) for other targets, DESIGN + ADRs, CI | hello-world `.exe`/`.app` runs on Windows x64/arm64, macOS arm64/x64 runners; cross-assembled from Linux too |
| M1 | AST analyzer, branding (icon/name/version), console/windowed, `resource_path`, args, exit codes, Unicode/space paths | fixtures `hello`, `args_exit_code`, `unicode_path`, `stdin_echo`, `gui_tk_window` green on all runners |
| M2 | declared deps, markers, transitive resolution, package data, certifi/SSL, sqlite3, `importlib.resources`, entry points, hook schema + 10 hooks | requests, rich, pydantic, jinja2, click, PyYAML fixtures |
| M3 | foreign-target wheels, native extensions, DLL/dylib collection, rcodesign, PE branding from non-Windows | Linux-built numpy/Pillow/cryptography/lxml/pandas apps run on Windows + both Macs |
| M4 | onefile payload (versioned header, zstd, hash), atomic locked extraction, cleanup, signing after append | 20 parallel first starts safe; warm-start overhead measured; `signtool verify` |
| M5 | multiprocessing, process pools, `sys.executable`, Tcl/Tk, Qt, matplotlib, scipy, asyncio, ctypes, pywin32 | one fixture + CI job each; honest `COMPATIBILITY.md` |
| M6 | DropRing converter/action/ring options/CLI/i18n/settings/toasts, docs TR/EN | drop `.py` on the ring → app appears; undo removes it |
| M7 | reproducibility check, SBOM + licences, size policy, fallback adapter, `doctor`, `--diag`, perf report | build twice → identical hashes; published size/startup numbers vs PyInstaller |

## 12. Pinned facts (verified 2026-11-15/16)

- python-build-standalone release `20261110`: CPython 3.11.18, 3.12.16, 3.13.18, 3.14.10, 3.15.2
  for `x86_64/aarch64-pc-windows-msvc`, `x86_64/aarch64-apple-darwin`,
  `x86_64/aarch64-unknown-linux-gnu`, flavour `install_only_stripped.tar.gz`, `SHA256SUMS` per
  release. 3.10.22 last appears in `20261009` (no Windows arm64 build).
- macOS runtime: interpreter linked into `lib/libpython3.14.dylib` (ad-hoc linker-signed,
  `minos 11.0` on arm64); only `_tkinter`/`_dbm` are separate modules; Tcl/Tk 9.0.
- Windows runtime: `python314.dll`, `vcruntime140*.dll`, `DLLs/*.pyd` incl. `_test*` modules,
  `tcl/`, `pip` in `Lib/site-packages`.
- Rust 1.99.0 (2026-10-01); uv 0.13.5 (2026-10-22); resedit 3.1.0 (2026-08-25); apple-codesign
  (`rcodesign`) 0.29.0. GitHub runners: `windows-latest` (Server 2025), `windows-11-arm`,
  `macos-15` (arm64), `macos-15-intel`, `ubuntu-latest`.
