"""M0 smoke fixture: reports facts about the packaged environment as one JSON line."""

import hashlib
import json
import os
import sqlite3
import ssl
import sys
import zlib

import dropring_pack_runtime as rt
from greeting import message  # local module next to the entry script

info = getattr(sys, "_dropring_pack", {})
base = os.path.normcase(os.path.realpath(info.get("base_dir", "")))
report = {
    "message": message(),
    "frozen": getattr(sys, "frozen", False),
    "helper_is_frozen": rt.is_frozen(),
    "argv": sys.argv[1:],
    "argv0_is_executable": sys.argv[0] == sys.executable,
    "prefix_in_bundle": os.path.normcase(os.path.realpath(sys.prefix)).startswith(base),
    "stdlib_in_bundle": os.path.normcase(os.path.realpath(json.__file__)).startswith(base),
    "python": "%d.%d" % sys.version_info[:2],
    "utf8_mode": sys.flags.utf8_mode,
    "user_site_disabled": sys.flags.no_user_site == 1 or sys.flags.isolated == 1,
    "optimize": sys.flags.optimize,
    "dont_write_bytecode": sys.dont_write_bytecode,
    "user_pythonpath_restored": os.environ.get("PYTHONPATH"),
    "user_pythonpath_not_on_sys_path": "/dropring-pack-test-nonexistent" not in sys.path,
    "launcher_vars_gone": "DROPRING_PACK_SAVED_ENV" not in os.environ,
    "ssl": ssl.OPENSSL_VERSION.split()[0],
    "sqlite_ok": sqlite3.connect(":memory:").execute("select 41 + 1").fetchone()[0] == 42,
    "zlib_ok": zlib.decompress(zlib.compress(b"x" * 100)) == b"x" * 100,
    "sha256_ok": hashlib.sha256(b"").hexdigest().startswith("e3b0c442"),
    "resource_exists": os.path.exists(rt.resource_path("greeting.py")),
}
print(json.dumps(report, sort_keys=True, ensure_ascii=False))
