# ADR-0004: Cross-target dependency installation with uv

Status: accepted for M2/M3 (not implemented in M0)

## Context

To build for target T on host H we must install T's wheels without running T's Python. Two
mainstream tools can do this:

- `pip install/download --platform <tag> --python-version X.Y --implementation cp --abi cp3XY
  --only-binary=:all: --target <dir>`
- `uv pip install --python-platform <triple> --python-version X.Y --only-binary :all: --target <dir>`

## Decision

Use **uv** (pinned release, binary downloaded per host with its published SHA-256; first pin
0.13.5 from 2026-10-22). Reasons:

1. uv evaluates environment markers (`sys_platform`, `platform_machine`, `os_name`, ...) for the
   **target** platform given by `--python-platform`. pip applies `--platform` only to wheel tags
   and still evaluates markers against the host, so building for Windows on a Mac silently drops
   dependencies such as `colorama; sys_platform == "win32"` (needed by click).
2. It is a single static binary, so the build machine still needs no Python.
3. It reads PEP 621 and PEP 723 inline metadata, supports `--require-hashes` and lockfiles, and is
   fast enough to resolve once per target.

Our own layer around it: map targets to `--python-platform` values (`x86_64-pc-windows-msvc`,
`aarch64-pc-windows-msvc`, `aarch64-apple-darwin`, `x86_64-apple-darwin`, ...), install into a
per-target staging dir, verify every `RECORD` hash, record each distribution in the manifest, and
turn "no matching distribution"/sdist-only failures into a structured report (package, version,
reason, suggestions: other version with wheels, matching CI runner, fallback engine).

## Consequences

- Poetry `[tool.poetry.dependencies]` and Pipfile need our own translation to requirement strings.
- macOS deployment target must be passed so uv does not pick wheels needing a newer macOS than the
  runtime's `LSMinimumSystemVersion`.
- If uv's CLI changes, only `builder/wheels.js` is affected.

## Rejected alternatives

- pip with `--platform`: wrong marker evaluation for foreign targets (above); needs a Python.
- Our own resolver against the PyPI JSON API: resolution with backtracking is a project in itself.
