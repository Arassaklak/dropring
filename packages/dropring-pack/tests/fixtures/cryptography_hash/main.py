"""cryptography (Rust extension with its own OpenSSL): SHA-256, Fernet and Ed25519; every
extension module must load. Dependency inferred from `import cryptography`."""

import importlib
import os
import sys


def load_extensions(packages, skip=()):
    """Import every compiled extension module (.so/.pyd) the given packages ship."""
    loaded, failures = 0, []
    for entry in sys.path:
        if os.path.basename(entry) != "site-packages":
            continue
        for package in packages:
            for root, dirs, files in os.walk(os.path.join(entry, package)):
                dirs.sort()
                for name in sorted(files):
                    if not name.endswith((".so", ".pyd")):
                        continue
                    module = os.path.relpath(os.path.join(root, name), entry).split(".")[0].replace(os.sep, ".")
                    if module in skip:
                        continue
                    try:
                        importlib.import_module(module)
                        loaded += 1
                    except Exception as exc:
                        failures.append("%s: %s: %s" % (module, type(exc).__name__, exc))
    return loaded, failures

import hashlib
import json

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ed25519

data = "dropring ✓".encode("utf-8")
h = hashes.Hash(hashes.SHA256())
h.update(data)
key = Fernet.generate_key()
private = ed25519.Ed25519PrivateKey.generate()
signature = private.sign(data)
private.public_key().verify(signature, data)  # raises if invalid
loaded, failures = load_extensions(["cryptography"])
print(json.dumps({
    "sha256_matches": h.finalize().hex() == hashlib.sha256(data).hexdigest(),
    "fernet_roundtrip": Fernet(key).decrypt(Fernet(key).encrypt(data)) == data,
    "ed25519_ok": len(signature) == 64,
    "extensions_loaded": loaded >= 1,
    "failures": failures,
}))
