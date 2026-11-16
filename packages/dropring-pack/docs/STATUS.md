# dropring-pack status

## M2 — third-party dependencies (2026-11-16)

New fixtures: `deps_requests` (requirements.txt), `deps_rich` (PEP 723), `deps_pydantic`
(pyproject.toml), `deps_click` (setup.cfg), `deps_jinja2` (inferred, project folder,
`importlib.resources`), `deps_yaml` (inferred via `yaml → PyYAML`), `deps_unknown` (must be
refused).

### Verified locally (macOS 26.6.2 arm64)

| What | Evidence |
|---|---|
| uv | 0.13.5 downloaded, SHA-256 matches the release digest, cached and reused |
| Cross-target resolution | from this Mac for Windows x64: `cp314-win_amd64.pyd` wheels for pydantic-core, PyYAML, markupsafe, charset-normalizer; markers for the target (`colorama` only on Windows for tqdm) |
| Wheel coverage, Python 3.14 | all six M2 packages resolve for all four targets; 3.10 for all but win-arm64 (no 3.10 runtime there); **3.15: PyYAML has no wheels yet** on any target |
| All 13 fixtures, mac-arm64, Python 3.14 | pass; real HTTPS to pypi.org with `requests` (certifi) and with `urllib` (system certificates) |
| Python 3.15, mac-arm64 | all dependency fixtures pass; `deps_yaml` refused with uv's reason and the three options |
| Cross-build for win-x64 from this Mac | all fixtures build; `deps_unknown` refused (runs on Windows happen in CI) |
| Unit tests | 43 pass, including RECORD tamper detection and every declared-dependency format (Poetry caret/tilde conversion, Pipfile, setup.cfg, PEP 723, dynamic pyproject refused) |

Findings fixed along the way:
- The cached runtime gained `.pyc` files whenever something ran it without `-B` (here: a manual
  test; potentially uv's interpreter check). Apps copied them, so the output depended on the
  cache's history. Runtime `__pycache__` folders are no longer copied, and uv runs with
  `PYTHONDONTWRITEBYTECODE=1`.
- python-build-standalone's Windows archive ships 612 `.pyc` files that are stale (they record
  the build-time source mtime, the archive resets sources to 2024-01-01), so Python ignored
  them; not copying them saves ~4.3 MB and 171 files per Windows app. Valid build-time
  bytecode is an M7 start-up optimisation.

## M1 — analyzer, branding, GUI apps (2026-11-16)

Fixtures `hello`, `args_exit_code`, `unicode_path`, `stdin_echo`, `gui_tk_window`,
`windowed_error`; every fixture app is built with the test icon, version 1.2.3, company and
copyright, so every run also exercises the branded launcher.

### Verified locally (macOS 26.6.2 arm64)

| What | Evidence |
|---|---|
| Unit tests | 34 builder tests pass (0.7 s; AST analyzer tests use any Python 3.10+ on PATH), 6 launcher tests |
| All six fixtures, mac-arm64 | pass (`tests/ci.js native`); `gui_tk_window` opens, maps and closes a Tk 9.0 window (app 37.2 MB with Tcl/Tk vs 29.1 MB without) |
| All six fixtures, mac-x64 under Rosetta 2 | pass |
| Finder-style launch | `windowed_error` started through LaunchServices (`open`), wrote `crash.log`, no dialog with `DROPRING_PACK_NO_DIALOGS=1` |
| Unicode | app "Ünïcode Äpp" moved into `yol ğüşiöç ✓/iç içe`, reads `veri/içerik ✓.txt` added with `--include` |
| AST analyzer | on a crafted project: type-only, optional, conditional, deferred, `__main__`-guarded and dynamic imports classified correctly; unreachable broken file not parsed; `distutils` reported as removed in 3.12 |
| macOS branding | `iconutil` accepts `AppIcon.icns` (16–1024 px); Info.plist has icon, version, copyright |
| Windows branding from a Mac host | resedit read-back: version strings, 7 icon sizes (16–256), DPI-aware manifest keeps UTF-8 code page and long-path setting |
| Zip | `ditto` unzip keeps the launcher executable and the signature valid; zipped apps run; two zips byte-identical |
| Bug found and fixed | `codesign` refused to seal bundles whose executable name is non-ASCII ("a sealed resource is missing or invalid"); executables are now ASCII-named |

### Verified in CI — run [43844831068](https://github.com/Arassaklak/dropring/actions/runs/43844831068) (commit `266a080`)

**All 18 jobs green; 72 of 72 fixture runs passed** (12 app jobs × 6 fixtures). Each "pass"
includes the branding check with the OS's own tools: PowerShell `VersionInfo` + icon resources
on Windows, `plutil` + `iconutil` on macOS. One job (`native mac-arm64 py3.14`) was first
cancelled by GitHub after 15 minutes without a runner (no steps ran); its re-run passed
(hello 258 ms, Tk window 940 ms median, 29.1 MB).

| Job (median ms of 5 runs: hello / tkinter window) | size MB (Tk app) | files |
|---|---|---|
| native win-x64 py3.14 | 34.8 (41.6) — 172 / 359 | 778 |
| native win-x64 py3.10 | 27.1 (37.3) — 176 / 358 | 839 |
| native win-x64 py3.15 | 37.4 (44.2) — 174 / 362 | 842 |
| native win-arm64 py3.14 | 35.7 (42.4) — 165 / 380 | 778 |
| native mac-arm64 py3.10 | 25.5 (33.7) — 168 / 605 | 662 |
| native mac-arm64 py3.15 | 31.2 (39.4) — 177 / 506 | 642 |
| native mac-x64 py3.14 | 29.8 (37.8) — 246 / 927 | 583 |
| Linux-built → win-x64 / win-arm64 | — 184 / 371, 184 / 407 | |
| Linux-built → mac-arm64 / mac-x64 | — 144 / 457, 405 / 1097 | |

Problems CI found in M1 and how they were fixed:
- A windowed Windows app *has* stdout when its parent passes pipes (only Explorer starts it
  without); the fixture no longer asserts `sys.stdout is None`.
- `fs.cpSync` killed the Node test runner on Windows for a non-ASCII destination path (no
  output, no error); the runner now copies file by file.
- Windows' built-in `tar.exe` converts zip entry names to the ANSI code page and skips names like
  `içerik ✓.txt`; .NET `ZipFile` (UTF-8 flag) extracts them. Our zips are fine; that tool is not.
- PowerShell `Expand-Archive` needed minutes for six ~800-file apps; .NET `ZipFile` is fast.

## M0 — spike (2026-11-16)

**Acceptance met:** the hello-world app runs on real Windows x64, Windows ARM64, macOS Apple
Silicon and macOS Intel runners, both when built on that runner and when assembled on Linux
(CI run 43836997444, below).

Local machine: macOS 26.6.2 arm64 (Apple Silicon), Node 26.5.0, Rust 1.99.0, Apple clang 21.

### Verified locally (commands run, results observed)

| What | Evidence |
|---|---|
| Runtime download + SHA-256 verification | `cpython-3.14.10+20261110-aarch64-apple-darwin-install_only_stripped.tar.gz` → `f15ec3d1…0171e02`, identical to the release `SHA256SUMS` and the GitHub API digest; Windows x64 archive `32b6cf90…12c520df` downloaded and verified for layout inspection. All 35 pins in `runtime/runtimes.json` generated from `SHA256SUMS` by `scripts/update-runtimes.js` |
| Launcher unit tests | `cargo test --release`: 6 passed |
| Launcher size | 303,296 bytes (arm64), 296,920 bytes (x86_64); ad-hoc linker-signed |
| Builder unit tests | `npm test`: 21 passed in 0.6 s, no network |
| `hello` + `args_exit_code` fixtures, mac-arm64 | PASS for Python 3.10.22, 3.11.18, 3.12.16, 3.13.18, 3.14.10, 3.15.2 (`tests/run-fixture.js`, 3–5 runs each) |
| mac-x64 (x86_64 launcher + runtime, assembled on arm64) | both fixtures PASS under Rosetta 2; `LSMinimumSystemVersion` 10.15 read from the runtime's Mach-O header |
| Isolation | app starts and ignores `PYTHONHOME`/`PYTHONPATH`/`PYTHONOPTIMIZE` set to bogus values; the user's `PYTHONPATH` is restored in `os.environ` for child processes |
| Exit codes, args, stdio | exit 7 propagated; arguments with spaces, quotes, empty string, Turkish characters intact; stderr separate; piped stdin read |
| Signals | SIGINT → `KeyboardInterrupt`, process dies by SIGINT (same as `python3.14`); SIGTERM → dies by SIGTERM |
| Tracebacks | unhandled exception → exit 1, traceback shows only application frames |
| multiprocessing (spawn) | `Pool.map`, `Process` + `Queue` work in the packaged app |
| Symlinked launch | `ln -s App.app/Contents/MacOS/App x; ./x` finds its bundle |
| Signing | `codesign --verify --deep --strict` valid; `spctl -a` rejects (expected for ad-hoc) |
| Reproducibility | two clean builds byte-identical (tar of the bundle incl. modes/mtimes: `61ef5d42…66d06` both times) |
| Size | hello onedir: 29.0 MB, 585 files (arm64) — 18.2 MB `libpython3.14.dylib`, 10.2 MB stdlib; 29.6 MB (x64) |
| Startup (hello, arm64) | warm median 46–60 ms; first launch of a new build 0.6–1.1 s (macOS first-run checks). Rosetta: first 2.4–2.8 s, median 93–114 ms |
| Build time | first build 42 s (25.7 MB runtime download); cached rebuild 0.62 s incl. signing |

### Verified in CI — run [43836997444](https://github.com/Arassaklak/dropring/actions/runs/43836997444) (commit `977d400`)

All 18 jobs passed in 2.5 minutes: unit tests, 4 launcher builds, 8 native fixture jobs,
the Linux cross-build and 4 runs of Linux-built apps. Every job runs both fixtures; a job fails
if any check in `expected.json` differs (see `tests/ci.js`).

| Fixture runs (first / median of 5, ms) | hello | args_exit_code | size MB | files |
|---|---|---|---|---|
| win-x64 py3.14 (windows-latest) | 164 / 147 | 145 / 130 | 34.7 | 778 |
| win-x64 py3.10 | 196 / 175 | 127 / 117 | 26.9 | 839 |
| win-x64 py3.15 | 158 / 136 | 259 / 106 | 37.3 | 842 |
| win-arm64 py3.14 (windows-11-arm) | 334 / 161 | 248 / 123 | 35.6 | 778 |
| mac-arm64 py3.14 (macos-15) | 168 / 167 | 105 / 105 | 29.0 | 585 |
| mac-arm64 py3.10 | 113 / 108 | 105 / 94 | 25.4 | 661 |
| mac-arm64 py3.15 | 181 / 180 | 183 / 133 | 31.1 | 641 |
| mac-x64 py3.14 (macos-15-intel) | 706 / 364 | 1277 / 314 | 29.6 | 582 |
| Linux-built → win-x64 | 201 / 177 | 141 / 140 | 34.7 | 778 |
| Linux-built → win-arm64 | 500 / 153 | 219 / 118 | 35.6 | 778 |
| Linux-built → mac-arm64 | 169 / 131 | 118 / 95 | 28.8 | 584 |
| Linux-built → mac-x64 | 304 / 302 | 285 / 252 | 29.5 | 581 |

Launchers built in CI (Rust 1.99.0):

| Target | console | windowed | checked |
|---|---|---|---|
| win-x64 | 245,760 B | 243,712 B | PE machine 0x8664, subsystem 3 / 2, manifest embedded, `/Brepro` timestamp |
| win-arm64 | 239,616 B | 238,080 B | PE machine 0xaa64, subsystem 3 / 2, manifest embedded |
| mac-arm64 | 303,296 B | 303,296 B | ad-hoc linker-signed |
| mac-x64 | 296,688 B | 296,688 B | |

What this proves beyond the Mac: `Py_Main` embedding, `._pth` + `-I` isolation and the static-CRT
launcher work on Windows x64 and ARM64 for Python 3.10, 3.14 and 3.15; a real Intel Mac runs the
x64 build; and an app assembled on Linux runs unchanged on all four targets (macOS bundles
unsealed, relying on the Mach-O files' own ad-hoc signatures).

### Observations

- The launcher binary is not byte-identical between a local Mac build and the CI build (different
  Apple SDK/linker versions; e.g. mac-x64 296,920 B locally vs 296,688 B in CI). App assembly is
  reproducible for identical inputs; a reproducible launcher build (pinned runner image, check that
  two CI builds match) is part of M7.
- GitHub warns that the pinned `actions/*@v4` actions target the deprecated Node 20 runtime; move
  to their Node 24 majors (also applies to the existing `build.yml`).
- Start-up on GitHub's runners (100–360 ms warm) is slower than on a local Apple Silicon Mac
  (46–60 ms); compare like with like when measuring against PyInstaller (M7).

### Known gaps (planned)

- Branding (icon, PE version info), `--include`, Windows windowed-mode crash dialog, Finder-launch
  error alert, AST analyzer, `unicode_path`/`stdin_echo`/`gui_tk_window` fixtures — M1.
- Third-party packages (requirements, wheels, hooks) — M2/M3. M0 bundles the standard library only.
- Signing from non-Mac hosts (`rcodesign`), Developer ID, notarization — M3.
- Building a macOS app on a Windows host loses the executable bit (NTFS); needs zip/tar output
  with explicit modes — M1 (`--zip`).
- Onefile — M4. `THIRD_PARTY_LICENSES` (PBS component licences) — M7. Stdlib precompilation and
  further trimming — M7.
