"""pandas (+ numpy, tzdata, dateutil): DataFrame, groupby, CSV round trip and time zones; every
pandas extension module must load. Dependency inferred from `import pandas`."""

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

import io
import json

import pandas as pd

df = pd.DataFrame({
    "şehir": ["İzmir", "Ankara", "İzmir"],
    "satış": [10, 20, 5],
    "tarih": pd.to_datetime(["2026-01-01", "2026-01-02", "2026-01-03"]).tz_localize("Europe/Istanbul"),
})
buf = io.StringIO()
df.to_csv(buf, index=False)
back = pd.read_csv(io.StringIO(buf.getvalue()))
loaded, failures = load_extensions(["pandas"])
print(json.dumps({
    "total": {k: int(v) for k, v in df.groupby("şehir")["satış"].sum().items()},
    "rows": len(back),
    "tz": str(df["tarih"].dt.tz),
    "extensions_loaded": loaded >= 20,
    "failures": failures,
}, ensure_ascii=False))
