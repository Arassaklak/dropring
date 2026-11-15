"""Helpers for applications packaged with dropring-pack.

Every function also works when the script runs unpackaged (``python main.py``),
so application code does not need two code paths::

    from dropring_pack_runtime import resource_path
    with open(resource_path("data/config.json")) as f:
        ...
"""

import os
import sys

__all__ = ["info", "is_frozen", "app_dir", "resource_path", "user_data_dir"]


def info():
    """Build information of the packaged app (dict), or None when not packaged."""
    return getattr(sys, "_dropring_pack", None)


def is_frozen():
    """True when running from an app built by dropring-pack."""
    return bool(getattr(sys, "frozen", False)) and info() is not None


def app_dir():
    """Folder holding the application's code and data files.

    Packaged: the bundle's ``app`` folder. Unpackaged: the entry script's folder.
    """
    data = info()
    if data:
        return data["app_dir"]
    main = sys.modules.get("__main__")
    path = getattr(main, "__file__", None)
    return os.path.dirname(os.path.abspath(path)) if path else os.getcwd()


def resource_path(relative):
    """Absolute path of a data file shipped with the app, given relative to app_dir()."""
    if os.path.isabs(relative):
        raise ValueError("resource_path() expects a path relative to the application folder")
    parts = [p for p in relative.replace("\\", "/").split("/") if p not in ("", ".")]
    if ".." in parts:
        raise ValueError("resource_path() does not accept '..'")
    return os.path.join(app_dir(), *parts)


def user_data_dir(app_name=None, roaming=True):
    """Per-user folder for settings and data (created if missing). Never inside the app bundle.

    Windows: %APPDATA%\\<name> (or %LOCALAPPDATA% with roaming=False),
    macOS: ~/Library/Application Support/<name>, Linux: $XDG_DATA_HOME/<name>.
    """
    data = info() or {}
    name = app_name or data.get("name") or os.path.splitext(os.path.basename(sys.argv[0] or ""))[0] or "python-app"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA" if roaming else "LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Roaming" if roaming else "Local")
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    path = os.path.join(base, name)
    os.makedirs(path, exist_ok=True)
    return path
