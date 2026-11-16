# ADR-0006: macOS signing — ad-hoc by default, codesign on Macs, rcodesign elsewhere

Status: accepted; ad-hoc signing implemented for macOS hosts (M0) and Linux/Windows hosts via rcodesign 0.29.0 (M3)

## Context

Apple Silicon refuses to run Mach-O code without a valid signature. A bundle that is copied or
modified must be re-sealed. Developer ID signing + notarization removes Gatekeeper warnings for
downloaded apps but needs the user's Apple credentials.

## Decision

- **Default: ad-hoc** (`--mac-sign adhoc`). On a macOS host: `codesign --force --sign -` on every
  Mach-O we placed (bottom-up), then on the `.app` to seal `Info.plist` and resources.
- **Non-Mac hosts:** `rcodesign sign <app>` from apple-platform-rs (pinned 0.29.0 + SHA-256 from
  the release's .sha256 files; Windows ARM64 hosts run the x64 build). Without a certificate it
  signs ad-hoc, signs the nested Mach-O files and seals the resources. Verified on a Mac
  (2026-11-16): Apple's `codesign --verify --deep --strict` accepts an rcodesign-signed bundle
  ("valid on disk", "satisfies its Designated Requirement", 732 sealed resources) and the app
  runs. `DROPRING_PACK_MAC_SIGNER=rcodesign` forces it on a Mac for such checks.
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
