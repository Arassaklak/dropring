# ADR-0002: Launcher written in Rust with no third-party crates

Status: accepted (M0)

## Context

The launcher is the only native code we ship in every app. It must be small, auditable,
reproducibly built, cheap to cross-build in CI, and should not look like malware to heuristic
antivirus engines.

## Decision

Rust (toolchain pinned to 1.99.0, `rust-toolchain.toml`), edition 2024, **zero third-party
crates**: the few OS functions needed (`LoadLibraryExW`, `GetProcAddress`, `MessageBoxW`,
`dlopen`, `dlsym`) are declared directly. Release profile: `opt-level="z"`, LTO, one codegen unit,
`panic="abort"`, stripped. Windows builds link the CRT statically (no `vcruntime140.dll`
dependency for the launcher itself), embed an application manifest at link time and use
`/Brepro` for deterministic PE timestamps. Two binaries: `dropring-pack-console` and
`dropring-pack-windowed` (`windows_subsystem = "windows"`); macOS uses the console binary inside
the `.app`.

Launchers are built on native CI runners for each target (`x86_64/aarch64-pc-windows-msvc`,
`x86_64/aarch64-apple-darwin`) and published with SHA-256 hashes; the builder never compiles.

## Consequences

- Small binaries without a runtime; memory-safe argument and path handling.
- Adding a crate requires an ADR update (supply-chain surface stays at the Rust std library).
- Cross-building the launcher itself is not needed on user machines, so Rust's harder macOS
  cross-compilation story does not matter.

## Rejected alternatives

- **Go:** trivial cross-compilation, but 1.5–2 MB binaries with a runtime and a long history of
  heuristic AV detections for Go executables.
- **C:** smallest output and a natural fit for embedding, but manual wide-string, path and error
  handling is where launcher bugs and security issues usually live.
