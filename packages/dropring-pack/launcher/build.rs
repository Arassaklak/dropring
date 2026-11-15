//! Build script: embeds the Windows application manifest and asks the MSVC
//! linker for a deterministic PE header (`/Brepro`). Nothing to do elsewhere.

fn main() {
    println!("cargo:rerun-if-changed=windows.manifest");
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if os != "windows" || env != "msvc" {
        return;
    }
    let dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo");
    let manifest = std::path::Path::new(&dir).join("windows.manifest");
    println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg-bins=/MANIFESTINPUT:{}", manifest.display());
    // Our manifest already carries trustInfo; stop the linker from adding a second one.
    println!("cargo:rustc-link-arg-bins=/MANIFESTUAC:NO");
    println!("cargo:rustc-link-arg-bins=/Brepro");
}
