# ADR-0005: Windows icon, version info and manifest edited with resedit

Status: accepted for M1 (not implemented in M0)

## Context

Branding (icon, ProductName, FileVersion, CompanyName, LegalCopyright, OriginalFilename,
manifest) must be written into the prebuilt launcher on any build host, including Linux and macOS.

## Decision

Use the `resedit` npm package (pure JavaScript, MIT, maintained; depends only on `pe-library`).
Pin **resedit 3.1.0** (2026-08-25) and **pe-library 2.0.1** via `overrides`; 3.1.1/2.0.3 were
published on 2026-11-15 and are not adopted until they have aged at least 14 days.

- The launcher ships with a default manifest embedded at link time (asInvoker, longPathAware,
  UTF-8 active code page, Windows 10/11 GUIDs). Branding replaces it when options differ
  (e.g. `--dpi-aware`).
- `.ico` files are generated from PNG/SVG at 16–256 px (M1; the DropRing app already has image
  tooling, but the package will use a small dependency-free ICO writer for PNG input).
- Resource edits happen before any signing; the PE checksum is recomputed.

## Rejected alternatives

- `rcedit` (Electron): Windows-only native binary.
- `llvm-rc`/`windres` at build time: requires toolchains on the user's machine.
- Writing our own PE resource editor: unnecessary while resedit is maintained; revisit if it is not.
