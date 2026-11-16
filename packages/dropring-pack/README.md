# dropring-pack

Turns a Python script or project into a standalone **Windows app folder (`.exe`)** or **macOS
`.app`** — from any build machine, without Python installed on either side, and without
PyInstaller. Part of [DropRing](../../README.md); usable on its own as a CLI and Node library.

> Status: **M1**. Pure-Python apps (standard library only), onedir output, Windows x64/ARM64 and
> macOS arm64/x64, icons and version info, GUI (tkinter) apps, data files, zips. Third-party
> dependencies (M2), onefile (M4) and the DropRing ring action (M6) are not there yet.
> Design: [docs/DESIGN.md](docs/DESIGN.md), decisions: [docs/adr/](docs/adr/), evidence:
> [docs/STATUS.md](docs/STATUS.md).

## How it works

```
your script ──► analyze ─► fetch pinned CPython (python-build-standalone, SHA-256 checked)
                        └► assemble: stripped runtime + your code + bootstrap + prebuilt launcher
                                     └► Info.plist / ad-hoc signature (macOS) ─► manifest.json
```

Imports are checked before anything is built: the code is parsed (never run) by a Python of the
same version as the app, so a missing module, a module that does not exist on a target OS
(`winreg` on macOS) or a syntax error is reported with file and line. The launcher is a
~240–300 KB Rust program with no dependencies. It loads the bundled Python library
in-process (`Py_Main`), so the app is one process with its own name and icon, normal exit codes,
Ctrl+C, stdin/stdout and Unicode arguments. Your code sees `sys.frozen == True` and can use
`dropring_pack_runtime.resource_path("data/file.json")`.

## Usage

```bash
npm install                      # in packages/dropring-pack
cd launcher && cargo build --release && cd ..   # or pass --launcher-dir with CI-built launchers
node builder/cli.js build path/to/app.py --name "My App" --target host
node builder/cli.js build path/to/project/ --target win-x64,mac-arm64 --launcher-dir dist-launchers
node builder/cli.js build game.py --windowed --icon icon.png --version 1.2.0 --company "Me" \
     --copyright "© 2026 Me" --include assets=assets --zip --target all --launcher-dir dist-launchers
node builder/cli.js inspect "dist/mac-arm64/My App.app"
node builder/cli.js runtimes list
node builder/cli.js doctor
```

Output: `dist/<target>/My App/My App.exe` (Windows) or `dist/<target>/My App.app` (macOS), plus
`<app>.manifest.json` with the SHA-256 of every file. Builds are reproducible
(`SOURCE_DATE_EPOCH` is honoured).

```js
const { build } = require('dropring-pack');
const controller = new AbortController();
const { artifacts, manifest, warnings } = await build(
  { entry: 'app.py', targets: ['win-x64', 'mac-arm64'], name: 'My App', out: 'dist', signal: controller.signal },
  (event) => console.log(event), // {type: 'stage'|'progress'|'warning'|'log', target, ...}
);
```

Environment: `DROPRING_PACK_CACHE` (cache folder), `DROPRING_PACK_OFFLINE=1` (never download),
`DROPRING_PACK_RUNTIME_MIRROR` (base URL of a python-build-standalone mirror).

## Unsigned apps

macOS apps are ad-hoc signed. Downloaded copies show a Gatekeeper warning on first start
(*System Settings → Privacy & Security → Open Anyway*); Developer ID signing and notarization are
planned (M3). Windows apps are unsigned unless you pass `--sign-cmd "signtool sign /fd sha256 /a {file}"`
(or any signing tool); unsigned apps may get a SmartScreen warning.

## Development

```bash
npm test                                   # builder unit tests (Node 22)
cd launcher && cargo test                  # launcher unit tests
node tests/ci.js native --target mac-arm64 # build + run every fixture on this machine
```

CI (`.github/workflows/dropring-pack.yml`) builds the launchers on Windows x64/ARM64 and both Mac
architectures, runs the fixtures natively for several Python versions, and cross-assembles all
targets on Linux and runs those apps on the matching runners.

## Licence

MIT. Apps built with dropring-pack contain CPython (PSF licence) and the components bundled by
python-build-standalone; collecting their licence texts into `THIRD_PARTY_LICENSES` is planned
for M7.
