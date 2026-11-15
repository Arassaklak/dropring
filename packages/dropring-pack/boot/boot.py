"""dropring-pack bootstrap.

The launcher runs this file as the interpreter's main script (see
docs/adr/0001-launcher-in-process-embedding.md). It prepares the frozen
environment and then executes the application's entry script as ``__main__``.
It runs on every start, so it stays small and imports almost nothing.
"""

import os
import sys

_BOOT_FILE = __file__
_SAVED_ENV = "DROPRING_PACK_SAVED_ENV"
_MP_CODE_PREFIXES = (
    "from multiprocessing.resource_tracker import main",
    "from multiprocessing.forkserver import main",
)


def _restore_environment():
    """Undo the launcher's environment isolation (POSIX "home" mode).

    The launcher removed every PYTHON* variable before the interpreter started,
    saved them hex-encoded and set PYTHONHOME. Put the user's values back so
    that child processes inherit the environment they would normally see.
    """
    saved = os.environ.pop(_SAVED_ENV, None)
    if saved is None:
        return
    os.environ.pop("PYTHONHOME", None)
    for item in saved.split(";"):
        name, _, value = item.partition("=")
        try:
            key, val = bytes.fromhex(name), bytes.fromhex(value)
        except ValueError:
            continue
        if not key:
            continue
        if os.name == "nt":
            os.environ[key.decode("utf-8", "replace")] = val.decode("utf-8", "replace")
        else:
            os.environb[key] = val


def _read_app_info(pack_dir):
    import json

    with open(os.path.join(pack_dir, "app.json"), "rb") as f:
        return json.loads(f.read().decode("utf-8"))


def _setup_path(base_dir, pack_dir, app_dir):
    """sys.path = [app, <runtime stdlib>, site-packages (+ .pth files), pack]."""
    norm = os.path.normcase
    stdlib = [p for p in sys.path if p and norm(os.path.abspath(p)) != norm(pack_dir)]
    sys.path[:] = [app_dir] + stdlib
    site_dir = os.path.join(base_dir, "site-packages")
    if os.path.isdir(site_dir):
        import site

        site.addsitedir(site_dir)
    sys.path.append(pack_dir)


def _serve_multiprocessing_child(argv):
    """Handle the ways multiprocessing re-launches a frozen executable.

    Only these exact forms are recognised; an application's own ``-c`` option is
    never interpreted as Python code.
    """
    if len(argv) >= 2 and argv[1] == "--multiprocessing-fork":
        from multiprocessing import spawn

        kwds = {}
        for arg in argv[2:]:
            name, _, value = arg.partition("=")
            kwds[name] = None if value == "None" else int(value)
        spawn.spawn_main(**kwds)  # exits the process
        return True
    if len(argv) >= 3 and argv[-2] == "-c" and argv[-1].startswith(_MP_CODE_PREFIXES):
        from subprocess import _args_from_interpreter_flags

        if argv[1:-2] == _args_from_interpreter_flags():
            exec(compile(argv[-1], "<multiprocessing>", "exec"), {"__name__": "__main__"})
            return True
    return False


def _excepthook(exc_type, exc, tb):
    """Hide this bootstrap's frames from tracebacks of the application.

    Frames are only removed when application frames remain, so errors inside the
    bootstrap itself stay visible. The trimmed traceback is stored on the exception
    because CPython 3.13+ prints ``exc.__traceback__`` and ignores the ``tb`` argument.
    """
    trimmed = tb
    while trimmed is not None and trimmed.tb_frame.f_code.co_filename == _BOOT_FILE:
        trimmed = trimmed.tb_next
    if trimmed is not None:
        tb = trimmed
        if exc is not None:
            exc.__traceback__ = tb
    sys.__excepthook__(exc_type, exc, tb)


def _run_entry(path):
    import builtins
    from importlib.machinery import SourceFileLoader
    from io import open_code

    with open_code(path) as f:
        source = f.read()
    code = compile(source, path, "exec", dont_inherit=True)
    module = type(sys)("__main__")
    module.__dict__.update(
        __file__=path,
        __cached__=None,
        __package__=None,
        __spec__=None,
        __loader__=SourceFileLoader("__main__", path),
        __builtins__=builtins,
    )
    sys.modules["__main__"] = module
    exec(code, module.__dict__)


def _main():
    _restore_environment()
    pack_dir = os.path.dirname(os.path.abspath(_BOOT_FILE))
    base_dir = os.path.dirname(pack_dir)
    app_dir = os.path.join(base_dir, "app")
    info = _read_app_info(pack_dir)

    sys.frozen = True
    sys._dropring_pack = {
        "base_dir": base_dir,
        "resource_dir": base_dir,
        "app_dir": app_dir,
        "name": info.get("name"),
        "app_id": info.get("appId"),
        "version": info.get("version"),
        "mode": info.get("mode"),
        "subsystem": info.get("subsystem"),
        "pack_version": info.get("packVersion"),
    }
    _setup_path(base_dir, pack_dir, app_dir)
    sys.argv[0] = sys.executable
    if _serve_multiprocessing_child(sys.argv):
        return
    sys.excepthook = _excepthook
    _run_entry(os.path.join(base_dir, *info["entry"].split("/")))


_main()
