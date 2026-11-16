"""Runs from a folder whose path has spaces and non-ASCII characters, under a non-ASCII app
name, and reads a data file added with --include through resource_path()."""

import json
import os
import sys
import unicodedata

from dropring_pack_runtime import resource_path


def nfc(s):
    return unicodedata.normalize("NFC", s)


with open(resource_path("veri/içerik ✓.txt"), encoding="utf-8") as f:
    text = f.read().strip()

print(json.dumps({
    "data": text,
    "exe_stem": nfc(os.path.splitext(os.path.basename(sys.executable))[0]),
    "exe_in_relocated_folder": "yol ğüşiöç ✓" in nfc(sys.executable),
    "argv": [nfc(a) for a in sys.argv[1:]],
}, ensure_ascii=False))
