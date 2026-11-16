"""numpy with its compiled core, BLAS/LAPACK (bundled OpenBLAS), FFT and random; every numpy
extension module must load. Dependency inferred from `import numpy`."""

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

import json

import numpy as np

m = np.arange(1, 10, dtype=float).reshape(3, 3) + np.eye(3)
loaded, failures = load_extensions(["numpy"])
print(json.dumps({
    "det": round(float(np.linalg.det(m)), 6),
    "solve_ok": bool(np.allclose(m @ np.linalg.solve(m, np.ones(3)), np.ones(3))),
    "fft_ok": bool(np.allclose(np.fft.ifft(np.fft.fft(np.arange(8))).real, np.arange(8))),
    "random_ok": len(np.random.default_rng(42).integers(0, 10, 3)) == 3,
    "extensions_loaded": loaded >= 10,
    "failures": failures,
}))
