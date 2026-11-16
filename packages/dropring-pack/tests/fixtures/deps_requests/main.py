"""requests over HTTPS with certifi's CA bundle, standard-library HTTPS with the system's
certificates, package metadata and entry points. Dependencies come from requirements.txt."""

import json
import os
import sys
import time
import urllib.request
from importlib.metadata import entry_points, version

import certifi
import charset_normalizer.md
import requests

URL = "https://pypi.org/simple/requests/"


def retry(fn, attempts=3):
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # network hiccups on CI runners
            last = exc
            time.sleep(2 * (i + 1))
    raise last


base = os.path.normcase(os.path.realpath(sys._dropring_pack["base_dir"]))
print(json.dumps({
    "requests_status": retry(lambda: requests.get(URL, timeout=30)).status_code,
    "stdlib_status": retry(lambda: urllib.request.urlopen(URL, timeout=30)).status,
    "certifi_in_bundle": os.path.normcase(os.path.realpath(certifi.where())).startswith(base),
    "metadata_version": bool(version("requests")),
    "entry_point_found": "normalizer" in {ep.name for ep in entry_points(group="console_scripts")},
    "compiled_extension": charset_normalizer.md.__file__.endswith((".so", ".pyd")),
}))
