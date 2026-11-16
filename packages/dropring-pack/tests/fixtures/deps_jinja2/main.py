"""Jinja2 renders a template shipped as package data (importlib.resources). No dependency is
declared: jinja2 and markupsafe are inferred from the imports. Built as a project folder."""

import json
from importlib.resources import files

import jinja2
import markupsafe._speedups

source = files("sablonlar").joinpath("selam.txt.j2").read_text(encoding="utf-8")
print(json.dumps({
    "rendered": jinja2.Template(source).render(ad="Dünya", n=3).strip(),
    "speedups": markupsafe._speedups.__file__.endswith((".so", ".pyd")),
}, ensure_ascii=False))
