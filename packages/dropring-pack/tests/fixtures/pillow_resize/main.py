"""Pillow draws, resizes (LANCZOS) and encodes PNG, JPEG and WebP with its bundled codec
libraries; every PIL extension module must load. Dependency inferred from `from PIL import`."""

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

from PIL import Image, ImageDraw, features

img = Image.new("RGB", (400, 300), (255, 255, 255))
ImageDraw.Draw(img).ellipse((50, 50, 350, 250), fill=(200, 30, 30))
small = img.resize((100, 75), Image.Resampling.LANCZOS)
encoded = {}
for fmt in ("PNG", "JPEG", "WEBP"):
    buf = io.BytesIO()
    small.save(buf, fmt)
    encoded[fmt] = buf.getvalue()
back = Image.open(io.BytesIO(encoded["PNG"]))
r, g, b = small.getpixel((50, 37))
# PIL._imagingtk bridges to tkinter; it loads only when the app uses tkinter (then Tcl/Tk is bundled).
loaded, failures = load_extensions(["PIL"], skip={"PIL._imagingtk"})
print(json.dumps({
    "size": list(back.size),
    "center_red": r > 150 and g < 100,
    "encoded": {k: len(v) > 100 for k, v in encoded.items()},
    "codecs": {k: features.check(k) for k in ("jpg", "zlib", "webp", "freetype2")},
    "extensions_loaded": loaded >= 5,
    "failures": failures,
}))
