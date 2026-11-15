# dropring-pack status

## M0 — spike (2026-11-16)

Machine: macOS 26.6.2 arm64 (Apple Silicon), Node 26.5.0, Rust 1.99.0, Apple clang 21.

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

### Not verified yet — needs the CI workflow

Pushing `dropring-pack/m0` runs `.github/workflows/dropring-pack.yml`:

- Windows x64 and ARM64: launcher build with embedded manifest and static CRT, `._pth` + `-I`
  isolation, `Py_Main` embedding, the fixtures for Python 3.10/3.14/3.15.
- A real Intel Mac (`macos-15-intel`) instead of Rosetta.
- Apps cross-assembled on Linux for all four targets, run on the matching runners.

### Known gaps (planned)

- Branding (icon, PE version info), `--include`, Windows windowed-mode crash dialog, Finder-launch
  error alert, AST analyzer, `unicode_path`/`stdin_echo`/`gui_tk_window` fixtures — M1.
- Third-party packages (requirements, wheels, hooks) — M2/M3. M0 bundles the standard library only.
- Signing from non-Mac hosts (`rcodesign`), Developer ID, notarization — M3.
- Building a macOS app on a Windows host loses the executable bit (NTFS); needs zip/tar output
  with explicit modes — M1 (`--zip`).
- Onefile — M4. `THIRD_PARTY_LICENSES` (PBS component licences) — M7. Stdlib precompilation and
  further trimming — M7.
