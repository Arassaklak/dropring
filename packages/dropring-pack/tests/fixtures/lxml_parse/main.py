"""lxml (bundled libxml2/libxslt): Unicode XML, XPath, XSLT and HTML parsing; every lxml
extension module must load. Dependency inferred from `from lxml import`."""

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

from lxml import etree

root = etree.fromstring("<kök><öğe ad='ç'>değer ✓</öğe><öğe ad='ş'>ikinci</öğe></kök>".encode("utf-8"))
xslt = etree.XSLT(etree.XML(
    '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">'
    '<xsl:output method="text"/><xsl:template match="/"><xsl:value-of select="count(//öğe)"/></xsl:template>'
    "</xsl:stylesheet>".encode("utf-8")))
html = etree.HTML("<p>merhaba <b>dünya</b></p>")
loaded, failures = load_extensions(["lxml"])
print(json.dumps({
    "names": root.xpath("//öğe/@ad"),
    "first": root.findtext("öğe"),
    "xslt_count": str(xslt(root)),
    "html_text": "".join(html.itertext()),
    "extensions_loaded": loaded >= 3,
    "failures": failures,
}, ensure_ascii=False))
