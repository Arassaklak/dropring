# ADR-0001: Launcher runs Python in-process (embedding), not as a child process

Status: accepted (M0) · supersedes the brief's "start with model B" recommendation

## Context

The brief offers two launcher models: **A** load the Python shared library and run in-process,
**B** spawn the bundled `python` and forward stdio, signals and exit code. B was recommended to
reach an end-to-end pipeline quickly, "add A later if profiling shows a benefit".

Looking at what B means on the targets, the cost is not performance but correctness that M1 has
to deliver anyway:

- **Windows:** the GUI process would be `pythonw.exe`, so the taskbar button, Alt-Tab and Tk
  window icon show Python's icon, Task Manager shows two processes, and Windows Firewall prompts
  name `python.exe`. Ctrl+C reaches both processes; the parent must ignore it, use a job object so
  the child dies with it, and still forward Ctrl+Break and console-close semantics.
- **macOS:** a Tk/Qt window from a child (or an `exec`'d) interpreter outside `Contents/MacOS`
  does not belong to the app bundle, so the Dock and menu bar show "Python". Fixing that means
  copying and re-linking the interpreter inside `Contents/MacOS`, which needs `install_name_tool`
  and therefore a Mac.
- The python-build-standalone macOS interpreter (`bin/python3.14`, 19 MB) and the library
  (`lib/libpython3.14.dylib`, 19 MB) are both complete; model A ships only the library.

Model A needs to configure the interpreter. The usual API (`PyConfig`) is a struct whose layout
changes with every minor version, which would force version-specific code in the launcher.

## Decision

The launcher dynamically loads the runtime's shared library and calls the stable-ABI function
`Py_Main` (Windows, `wchar_t` argv) or `Py_BytesMain` (POSIX). Configuration is done through
mechanisms that are stable across 3.10–3.15:

- Windows: `python3XY._pth` next to the DLL (path list, implies isolated mode, skips the registry,
  sets `home`), plus `-I` on the command line so preconfig ignores `PYTHON*` variables too.
- POSIX: scrub `PYTHON*` variables (saved for the bootstrap to restore), set `PYTHONHOME`, pass
  `-s`. `._pth` is not usable on macOS because it would have to live in `Contents/MacOS`, where a
  data file breaks code signing.
- Both: `-B`, `-X utf8` (configurable), then the bootstrap script path, then the user's arguments.

The launcher reads a tiny `key=value` config (`dropring-pack.cfg`) so it stays generic: one
prebuilt binary per target and subsystem serves every app and every Python minor version.

## Consequences

- One process; exit codes, signals, stdio and Unicode argv behave like `python script.py`.
- `sys.executable` is the app. Multiprocessing spawns the app with `--multiprocessing-fork`;
  the bootstrap handles that (and the exact resource-tracker/forkserver `-c` forms). Code that runs
  `[sys.executable, "-m", "pip"]` cannot work (same as PyInstaller); documented in M5.
- Verification burden: the `getpath` behaviour must be checked for every supported minor version
  on Windows and macOS in CI (C implementation in 3.10, `getpath.py` from 3.11).
- A child-process mode stays possible behind the same config file (`mode=spawn`) as a fallback for
  platforms where only a static interpreter exists (python-build-standalone Linux builds may need
  it; Linux is a stretch target).

## Rejected alternatives

- **B, child process** — identity problems above; would be rewritten in M1.
- **B', `exec` the interpreter (POSIX)** — keeps the PID, but the image is outside the bundle
  (Dock identity) unless re-linked on a Mac.
- **`PyConfig` with per-version struct layouts** — maintenance cost per CPython release; revisit
  only if `Py_Main` proves insufficient. PEP 741's string-keyed init API exists only from 3.14.
