# ADR-0007: Builder in plain CommonJS with JSDoc types

Status: accepted (M0)

## Context

DropRing is plain CommonJS JavaScript with no build step (`require` everywhere, Electron main
process). The packager must plug into its engine as a converter and also run as a standalone CLI.

## Decision

Write the builder as CommonJS modules for Node ≥ 20 with JSDoc type annotations (checkable with
`tsc --noEmit --allowJs --checkJs` later, no emitted output). Tests use `node:test`. Runtime
dependencies are kept minimal and pinned: `tar` (archive extraction with path-traversal
protection) now; `resedit` in M1; zstd comes from Node's own `zlib` (M4).

## Consequences

- DropRing can `require('dropring-pack')` directly; no transpilation in the Electron build.
- Type safety is opt-in via JSDoc; CI can add a `checkJs` step without changing the code.

## Rejected alternatives

- TypeScript with a compile step: adds a build to both the package and DropRing's packaging.
