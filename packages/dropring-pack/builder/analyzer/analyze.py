"""dropring-pack static analyzer.

Run by the builder with a python-build-standalone interpreter of the *target's* Python minor
version (``python -I -S -B -X utf8 analyze.py``), so the parser accepts exactly the syntax the
app will run with. It only parses source files with ``ast``; it never imports or executes the
code it analyzes.

Input on stdin (JSON)::

    {"root": "/abs/project", "mode": "file" | "project", "entry": "main.py",
     "hidden": ["pkg.mod"], "exclude": ["mod"]}

Output on stdout (JSON): see ``main()``.
"""

import ast
import json
import os
import sys

GUI_TOOLKITS = {
    "tkinter": "tkinter", "_tkinter": "tkinter", "turtle": "tkinter", "idlelib": "tkinter",
    "customtkinter": "tkinter", "ttkbootstrap": "tkinter", "PySimpleGUI": "tkinter", "FreeSimpleGUI": "tkinter",
    "PyQt5": "Qt", "PyQt6": "Qt", "PySide2": "Qt", "PySide6": "Qt", "qtpy": "Qt",
    "wx": "wxPython", "kivy": "Kivy", "pygame": "pygame", "pyglet": "pyglet", "arcade": "arcade",
    "flet": "Flet", "dearpygui": "Dear PyGui", "toga": "Toga", "webview": "pywebview",
}
TK_MODULES = {"tkinter", "_tkinter", "turtle", "idlelib", "turtledemo"}
# Strength order when one module is imported in several ways.
KIND_RANK = {"typing": 0, "optional": 1, "deferred": 2, "conditional": 3, "required": 4}
SKIP_DIRS = {"__pycache__", ".git", ".hg", ".svn", ".venv", "venv", "env", ".tox", ".nox", ".mypy_cache",
             ".pytest_cache", ".ruff_cache", ".idea", ".vscode", "node_modules", "dist", "build", ".eggs"}
OWN_MODULES = {"dropring_pack_runtime"}


def handler_catches_import_error(handler):
    if handler.type is None:
        return True
    names = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
    for n in names:
        if isinstance(n, ast.Name) and n.id in ("ImportError", "ModuleNotFoundError", "Exception", "BaseException"):
            return True
        if isinstance(n, ast.Attribute) and n.attr in ("ImportError", "ModuleNotFoundError"):
            return True
    return False


def is_type_checking(test):
    return (isinstance(test, ast.Name) and test.id == "TYPE_CHECKING") or (
        isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING")


def is_main_guard(test):
    """`if __name__ == "__main__":`"""
    return (isinstance(test, ast.Compare) and isinstance(test.left, ast.Name) and test.left.id == "__name__"
            and len(test.ops) == 1 and isinstance(test.ops[0], ast.Eq) and len(test.comparators) == 1
            and isinstance(test.comparators[0], ast.Constant) and test.comparators[0].value == "__main__")


class Visitor(ast.NodeVisitor):
    def __init__(self, rel, package, is_entry=False):
        self.rel = rel
        self.is_entry = is_entry  # the entry script runs as __main__
        self.package = package  # dotted package containing this module ('' for top level)
        self.ctx = []
        self.imports = []  # (dotted, level, names, kind, line)
        self.dynamic = []  # (line, expression text, resolved or None, kind)
        self.import_module_aliases = {"import_module"}

    def kind(self):
        if "typing" in self.ctx:
            return "typing"
        if "try" in self.ctx:
            return "optional"
        if "def" in self.ctx:
            return "deferred"
        if "if" in self.ctx:
            return "conditional"
        return "required"

    def visit_Import(self, node):
        for alias in node.names:
            self.imports.append((alias.name, 0, [], self.kind(), node.lineno))

    def visit_ImportFrom(self, node):
        self.imports.append((node.module or "", node.level, [a.name for a in node.names], self.kind(), node.lineno))
        if node.module == "importlib":
            for a in node.names:
                if a.name == "import_module":
                    self.import_module_aliases.add(a.asname or a.name)

    def _scoped(self, label, nodes):
        self.ctx.append(label)
        for n in nodes:
            self.visit(n)
        self.ctx.pop()

    def visit_Try(self, node):
        if any(handler_catches_import_error(h) for h in node.handlers):
            self._scoped("try", node.body)
        else:
            for n in node.body:
                self.visit(n)
        for part in (node.handlers, node.orelse, node.finalbody):
            for n in part:
                self.visit(n)

    visit_TryStar = visit_Try

    def visit_If(self, node):
        if is_type_checking(node.test):
            self._scoped("typing", node.body)
            for n in node.orelse:
                self.visit(n)
            return
        if self.is_entry and is_main_guard(node.test):
            for n in node.body:  # always runs in the entry script
                self.visit(n)
            self._scoped("if", node.orelse)
            return
        self.visit(node.test)
        self._scoped("if", node.body)
        self._scoped("if", node.orelse)

    def visit_Match(self, node):
        self.visit(node.subject)
        for case in node.cases:
            self._scoped("if", case.body)

    def visit_FunctionDef(self, node):
        for d in node.decorator_list:
            self.visit(d)
        self._scoped("def", node.body)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Lambda(self, node):
        self._scoped("def", [node.body])

    def visit_Call(self, node):
        func = node.func
        name = None
        if isinstance(func, ast.Name) and (func.id == "__import__" or func.id in self.import_module_aliases):
            name = func.id
        elif isinstance(func, ast.Attribute) and func.attr == "import_module":
            name = "importlib.import_module"
        if name and node.args:
            arg = node.args[0]
            package = None
            for kw in node.keywords:
                if kw.arg == "package" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                    package = kw.value.value
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                target = arg.value
                if target.startswith(".") and package:
                    level = len(target) - len(target.lstrip("."))
                    target = resolve_relative(target.lstrip("."), level, package)
                resolved = None if (target is None or target.startswith(".")) else target
                self.dynamic.append((node.lineno, ast.unparse(node)[:120], resolved, self.kind()))
            else:
                self.dynamic.append((node.lineno, ast.unparse(node)[:120], None, self.kind()))
        self.generic_visit(node)


def resolve_relative(module, level, package):
    """Absolute module name for a relative import, or None if it climbs above the top level."""
    if level == 0:
        return module
    parts = package.split(".") if package else []
    if level - 1 > len(parts) or (not parts and level >= 1):
        return None
    base = parts[: len(parts) - (level - 1)]
    return ".".join(base + ([module] if module else []))


class Project:
    def __init__(self, root):
        self.root = root

    def _is_package_dir(self, path):
        if not os.path.isdir(path):
            return False
        if os.path.isfile(os.path.join(path, "__init__.py")):
            return True
        try:  # PEP 420 namespace package: a folder with Python files
            return any(n.endswith(".py") for n in os.listdir(path))
        except OSError:
            return False

    def locate(self, dotted):
        """('module', rel) / ('package', rel_dir) for the longest local prefix of `dotted`, or None."""
        path = self.root
        found = None
        for i, part in enumerate(dotted.split(".")):
            if not part.isidentifier():
                return found
            pkg = os.path.join(path, part)
            mod = pkg + ".py"
            if self._is_package_dir(pkg):
                found = ("package", os.path.relpath(pkg, self.root).replace(os.sep, "/"))
                path = pkg
            elif os.path.isfile(mod):
                return ("module", os.path.relpath(mod, self.root).replace(os.sep, "/"))
            else:
                return found
        return found

    def tree_files(self, rel_dir):
        out = []
        for dirpath, dirnames, filenames in os.walk(os.path.join(self.root, rel_dir)):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.endswith(".egg-info"))
            for f in sorted(filenames):
                if f.endswith((".pyc", ".pyo")) or f in (".DS_Store", "Thumbs.db") or f == ".env" or f.startswith(".env."):
                    continue
                out.append(os.path.relpath(os.path.join(dirpath, f), self.root).replace(os.sep, "/"))
        return out


def module_package(rel):
    """Package that a project file belongs to, from its path (top-level files have none)."""
    parts = rel[:-3].split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
        return ".".join(parts)
    return ".".join(parts[:-1])


def main():
    req = json.load(sys.stdin)
    root = req["root"]
    project = Project(root)
    stdlib = set(sys.stdlib_module_names)
    exclude = {m.split(".")[0] for m in req.get("exclude", [])}

    # Both modes follow the import graph from the entry script: only reachable files are parsed
    # (a broken unrelated script in a project folder does not fail the build). In file mode the
    # reachable files are also what gets copied; project mode copies the whole folder.
    include = {req["entry"]}
    queue = [req["entry"]]
    parsed = set()

    modules = {}  # top-level name -> {kind, category, where}
    dynamic, syntax_errors, warnings = [], [], []

    def note(top, kind, category, where):
        cur = modules.get(top)
        if cur is None or KIND_RANK[kind] > KIND_RANK[cur["kind"]]:
            modules[top] = {"kind": kind, "category": category, "where": where}

    def use_local(dotted):
        hit = project.locate(dotted)
        if not hit:
            return False
        kind, rel = hit
        if kind == "module":
            if rel not in include:
                include.add(rel)
                queue.append(rel)
        else:  # a package: take the whole folder (code and data files)
            top_dir = rel.split("/")[0]
            for f in project.tree_files(top_dir):
                if f not in include:
                    include.add(f)
                    if f.endswith(".py"):
                        queue.append(f)
        return True

    def handle(dotted, kind, where):
        top = dotted.split(".")[0]
        if not top or top in exclude:
            return
        if project.locate(top):
            use_local(dotted)
            if top in stdlib and kind != "typing":
                warnings.append("%s: local %s shadows the standard library module of the same name" % (where, top))
            note(top, kind, "local", where)
        elif top in stdlib:
            note(top, kind, "stdlib", where)
        elif top in OWN_MODULES:
            note(top, kind, "own", where)
        else:
            note(top, kind, "third-party", where)

    for name in req.get("hidden", []):
        handle(name, "required", "--hidden-import")

    while queue:
        rel = queue.pop(0)
        if rel in parsed:
            continue
        parsed.add(rel)
        path = os.path.join(root, *rel.split("/"))
        try:
            with open(path, "rb") as f:
                tree = ast.parse(f.read(), filename=rel)
        except SyntaxError as e:
            syntax_errors.append({"where": "%s:%s:%s" % (rel, e.lineno or 0, e.offset or 0), "message": e.msg})
            continue
        except (OSError, ValueError) as e:
            syntax_errors.append({"where": rel, "message": str(e)})
            continue
        is_entry = rel == req["entry"]
        package = "" if is_entry else module_package(rel)
        v = Visitor(rel, package, is_entry)
        v.visit(tree)
        for dotted, level, names, kind, line in v.imports:
            where = "%s:%d" % (rel, line)
            if level:
                base = resolve_relative(dotted, level, package)
                if base is None:
                    warnings.append("%s: relative import beyond the top-level package (fails at runtime)" % where)
                    continue
                targets = [base] + ["%s.%s" % (base, n) if base else n for n in names if n != "*"]
            else:
                targets = [dotted] + ["%s.%s" % (dotted, n) for n in names if n != "*"]
            for t in targets:
                if t and (t == targets[0] or project.locate(t)):
                    handle(t, kind, where)
        for line, expr, resolved, kind in v.dynamic:
            where = "%s:%d" % (rel, line)
            if resolved:
                handle(resolved, kind, where)
            else:
                dynamic.append({"where": where, "expression": expr})

    gui = sorted({GUI_TOOLKITS[m] for m, i in modules.items() if m in GUI_TOOLKITS and i["kind"] != "typing"})
    uses_tk = any(m in TK_MODULES and i["kind"] != "typing" for m, i in modules.items()) or any(
        m in ("customtkinter", "ttkbootstrap", "PySimpleGUI", "FreeSimpleGUI") for m in modules)
    json.dump({
        "python": "%d.%d.%d" % sys.version_info[:3],
        "files": sorted(include),
        "modules": dict(sorted(modules.items())),
        "dynamic": dynamic,
        "syntaxErrors": syntax_errors,
        "warnings": warnings,
        "gui": gui,
        "usesTkinter": uses_tk,
    }, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
