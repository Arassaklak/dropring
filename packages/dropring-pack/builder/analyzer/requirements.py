"""dropring-pack: read a project's declared dependencies without executing anything.

Run by the builder with a python-build-standalone interpreter (3.11+, for tomllib) as
``python -I -S -B -X utf8 requirements.py``. setup.py is never run (ADR-0009).

Input on stdin (JSON)::

    {"root": "/abs/project", "entry": "main.py", "mode": "file" | "project"}

Output on stdout (JSON)::

    {"source": "pyproject.toml" | ..., "path": "...", "requirements": ["pkg>=1", ...],
     "passthrough": "/abs/requirements.txt" | null, "warnings": [...]}

``passthrough`` is a requirements file handed to uv unchanged (it may contain options and
includes); ``requirements`` are PEP 508 strings extracted from other formats.
"""

import configparser
import json
import os
import re
import sys

try:
    import tomllib
except ImportError:  # Python 3.10
    tomllib = None

PEP723 = re.compile(r"(?m)^# /// (?P<type>[a-zA-Z0-9-]+)$\s(?P<content>(^#(| .*)$\s)+)^# ///$")


def pep723(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    blocks = [m for m in PEP723.finditer(text) if m.group("type") == "script"]
    if not blocks:
        return None
    if len(blocks) > 1:
        raise ValueError("more than one '# /// script' block")
    content = "".join(line[2:] if line.startswith("# ") else line[1:] for line in blocks[0].group("content").splitlines(keepends=True))
    return list(tomllib.loads(content).get("dependencies", []))


def _caret(version):
    parts = [int(p) if p.isdigit() else p for p in version.split(".")]
    nums = [p for p in parts if isinstance(p, int)]
    for i, p in enumerate(nums):  # first non-zero component decides the upper bound
        if p != 0 or i == len(nums) - 1:
            upper = nums[:i] + [p + 1]
            break
    return ">=%s,<%s" % (version, ".".join(str(n) for n in upper))


def _tilde(version):
    nums = [int(p) for p in version.split(".") if p.isdigit()]
    upper = [nums[0] + 1] if len(nums) == 1 else nums[:1] + [nums[1] + 1]
    return ">=%s,<%s" % (version, ".".join(str(n) for n in upper))


def poetry_constraint(c):
    c = c.strip()
    if c in ("", "*"):
        return ""
    out = []
    for part in [p.strip() for p in c.split(",")]:
        if part.startswith("^"):
            out.append(_caret(part[1:].strip()))
        elif part.startswith("~") and not part.startswith("~="):
            out.append(_tilde(part[1:].strip()))
        elif part[0].isdigit():
            out.append("==" + part)
        else:
            out.append(part)
    return ",".join(out)


def poetry_spec(name, c, warnings):
    if isinstance(c, list):
        warnings.append("%s: multiple-constraint Poetry dependencies are not supported; using the first" % name)
        c = c[0]
    if isinstance(c, str):
        return name + poetry_constraint(c)
    if c.get("optional"):
        return None
    if any(k in c for k in ("git", "path", "url")):
        warnings.append("%s: git/path/url dependencies are not supported; put a version in requirements.txt" % name)
        return None
    extras = "[%s]" % ",".join(c["extras"]) if c.get("extras") else ""
    spec = name + extras + poetry_constraint(c.get("version", "*"))
    if c.get("markers"):
        spec += "; " + c["markers"]
    return spec


def pyproject(path, warnings):
    with open(path, "rb") as f:
        data = tomllib.load(f)
    project = data.get("project") or {}
    if "dependencies" in project:
        return list(project["dependencies"])
    if "dependencies" in project.get("dynamic", []):
        raise ValueError("dependencies are dynamic (computed by the build backend); list them in requirements.txt")
    poetry = ((data.get("tool") or {}).get("poetry") or {}).get("dependencies")
    if poetry:
        specs = [poetry_spec(n, c, warnings) for n, c in poetry.items() if n.lower() != "python"]
        return [s for s in specs if s]
    return None


def setup_cfg(path):
    cp = configparser.ConfigParser()
    cp.read(path, encoding="utf-8")
    value = cp.get("options", "install_requires", fallback=None)
    if value is None:
        return None
    return [l.strip() for l in value.splitlines() if l.strip() and not l.strip().startswith("#")]


def pipfile(path, warnings):
    with open(path, "rb") as f:
        data = tomllib.load(f)
    out = []
    for name, c in (data.get("packages") or {}).items():
        if isinstance(c, str):
            out.append(name + ("" if c == "*" else c))
        elif any(k in c for k in ("git", "path", "file")):
            warnings.append("%s: git/path dependencies from Pipfile are not supported" % name)
        else:
            spec = name + ("[%s]" % ",".join(c["extras"]) if c.get("extras") else "") + ("" if c.get("version", "*") == "*" else c["version"])
            if c.get("markers"):
                spec += "; " + c["markers"]
            out.append(spec)
    return out


def main():
    req = json.load(sys.stdin)
    root, entry = req["root"], req["entry"]
    warnings = []
    here = lambda name: os.path.join(root, name)
    candidates = [("requirements.txt", None), ("pyproject.toml", pyproject), ("setup.cfg", setup_cfg), ("Pipfile", pipfile)]
    script = ("PEP 723 block in %s" % entry, here(entry))
    order = []
    if req["mode"] == "file":
        order.append(script)  # a dropped script's own metadata is the most specific
    order.extend((name, here(name)) for name, _ in candidates)
    if req["mode"] == "project":
        order.append(script)
    parsers = dict(candidates)
    for label, path in order:
        if not os.path.isfile(path):
            continue
        if label == "requirements.txt":
            print(json.dumps({"source": label, "path": path, "requirements": [], "passthrough": path, "warnings": warnings}))
            return
        if tomllib is None and label in ("pyproject.toml", "Pipfile") or (tomllib is None and label.startswith("PEP 723")):
            warnings.append("%s needs Python 3.11+ to read; skipped" % label)
            continue
        try:
            if label.startswith("PEP 723"):
                found = pep723(path)
            elif parsers[label] in (pyproject, pipfile):
                found = parsers[label](path, warnings)
            else:
                found = parsers[label](path)
        except (ValueError, OSError, configparser.Error) as e:
            raise SystemExit(json.dumps({"error": "%s: %s" % (label, e)}))
        except Exception as e:  # tomllib.TOMLDecodeError and friends
            raise SystemExit(json.dumps({"error": "%s: %s" % (label, e)}))
        if found is not None:
            print(json.dumps({"source": label, "path": path, "requirements": found, "passthrough": None, "warnings": warnings}))
            return
    print(json.dumps({"source": None, "path": None, "requirements": [], "passthrough": None, "warnings": warnings}))


if __name__ == "__main__":
    main()
