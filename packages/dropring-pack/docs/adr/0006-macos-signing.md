# ADR-0006: macOS signing — ad-hoc by default, codesign on Macs, rcodesign elsewhere

Status: accepted (M0 for macOS hosts; non-Mac hosts in M3)

## Context

Apple Silicon refuses to run Mach-O code without a valid signature. A bundle that is copied or
modified must be re-sealed. Developer ID signing + notarization removes Gatekeeper warnings for
downloaded apps but needs the user's Apple credentials.

## Decision

- **Default: ad-hoc** (`--mac-sign adhoc`). On a macOS host: `codesign --force --sign -` on every
  Mach-O we placed (bottom-up), then on the `.app` to seal `Info.plist` and resources.
- **Non-Mac hosts (M3):** `rcodesign` from apple-platform-rs (pinned 0.29.0 + SHA-256), same
  order. Until then, cross-assembled macOS apps rely on the linker signatures already present in
  the launcher and python-build-standalone binaries (we do not modify those files), and the build
  log says the bundle itself is unsealed.
- **Developer ID** (`--mac-sign identity:<name>`): hardened runtime, secure timestamp,
  entitlements file (defaults: none; `allow-jit`/`disable-library-validation` only when a hook
  asks), then optional notarization via `xcrun notarytool submit --wait` + `stapler staple`
  (macOS host) or `rcodesign notary-submit` (others). Credentials only via environment/keychain
  profile, never logged.
- `--mac-sign none` leaves signatures untouched.

## Consequences

- Unsigned or ad-hoc apps show the Gatekeeper warning after download; docs explain
  "System Settings → Privacy & Security → Open Anyway" honestly.
- Notarization may reject Mach-O files under `Contents/Resources`; an M3 spike decides whether
  `.so/.dylib` move to `Contents/Frameworks` (with symlinks) for identity-signed builds.
- universal2 (`lipo` of both launchers + universal wheels) is a stretch goal.
