//! dropring-pack launcher.
//!
//! Finds the bundle's `dropring-pack.cfg`, prepares an isolated interpreter
//! configuration and runs the bootstrap script in-process through CPython's
//! stable-ABI entry point: `Py_Main` on Windows, `Py_BytesMain` elsewhere.
//! Design: packages/dropring-pack/docs/adr/0001-launcher-in-process-embedding.md
//!
//! The launcher is generic: one binary per target and subsystem serves every
//! app and every supported Python minor version. Everything app-specific lives
//! in the config file written by the builder.

#![deny(unsafe_op_in_unsafe_fn)]

pub mod config;
#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(unix)]
use unix as platform;
#[cfg(windows)]
use windows as platform;

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

pub use config::Config;

/// Launcher version; the builder records it in the app manifest.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Name of the configuration file written by the builder.
pub const CONFIG_FILE: &str = "dropring-pack.cfg";

/// Environment variable carrying the user's `PYTHON*` variables (hex-encoded)
/// from the launcher to the bootstrap, which restores them for child processes.
pub const SAVED_ENV_VAR: &str = "DROPRING_PACK_SAVED_ENV";

/// Exit status when the launcher fails before Python runs.
const EXIT_LAUNCHER_ERROR: i32 = 1;

/// Set (to any value) to suppress error dialogs, e.g. in CI or scripted runs. The bootstrap
/// honours the same variable for crash dialogs of the Python application.
pub const NO_DIALOGS_VAR: &str = "DROPRING_PACK_NO_DIALOGS";

/// False when the user or a test harness asked for no modal dialogs.
pub fn dialogs_allowed() -> bool {
    std::env::var_os(NO_DIALOGS_VAR).is_none()
}

/// Everything the platform layer needs to start the interpreter.
pub struct Launch {
    /// Absolute path of this executable; becomes `sys.executable`.
    pub exe: PathBuf,
    /// Directory containing `dropring-pack.cfg`; config paths are relative to it.
    pub base: PathBuf,
    pub config: Config,
    /// The user's arguments, without argv[0].
    pub args: Vec<OsString>,
}

/// Entry point shared by the console and windowed binaries. Never returns.
pub fn main(windowed: bool) -> ! {
    let code = match prepare().and_then(|launch| platform::run(&launch)) {
        Ok(code) => code,
        Err(message) => {
            platform::report_error(windowed, &message);
            EXIT_LAUNCHER_ERROR
        }
    };
    std::process::exit(code)
}

fn prepare() -> Result<Launch, String> {
    let exe = current_exe()?;
    let base = locate_base(&exe)?;
    let cfg_path = base.join(CONFIG_FILE);
    let text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("cannot read {}: {e}", cfg_path.display()))?;
    let config = Config::parse(&text)?;
    let args = std::env::args_os().skip(1).collect();
    Ok(Launch { exe, base, config, args })
}

fn current_exe() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot determine the executable path: {e}"))?;
    // Resolve symlinks on POSIX so that e.g. /usr/local/bin/app -> App.app/Contents/MacOS/App
    // still finds the bundle. On Windows keep the path as reported: canonicalize() would turn it
    // into a `\\?\` verbatim path that would leak into sys.executable.
    #[cfg(unix)]
    let exe = exe
        .canonicalize()
        .map_err(|e| format!("cannot resolve {}: {e}", exe.display()))?;
    Ok(exe)
}

/// The config lives in `Contents/Resources` (macOS bundle) or `_internal` next to the executable.
fn locate_base(exe: &Path) -> Result<PathBuf, String> {
    let dir = exe
        .parent()
        .ok_or_else(|| format!("executable path has no parent: {}", exe.display()))?;
    let mut candidates = Vec::with_capacity(2);
    if dir.file_name() == Some(OsStr::new("MacOS")) {
        if let Some(contents) = dir.parent() {
            candidates.push(contents.join("Resources"));
        }
    }
    candidates.push(dir.join("_internal"));
    for candidate in candidates {
        if candidate.join(CONFIG_FILE).is_file() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "this application is incomplete: {CONFIG_FILE} was not found for {}. \
         Copy the whole application folder, not only the executable.",
        exe.display()
    ))
}

/// Builds the interpreter's argv: `[exe, flags..., boot script, user args...]`.
pub fn interpreter_argv(launch: &Launch) -> Result<Vec<OsString>, String> {
    let boot = config::resolve(&launch.base, &launch.config.boot)?;
    let mut argv = Vec::with_capacity(launch.config.flags.len() + launch.args.len() + 2);
    argv.push(launch.exe.clone().into_os_string());
    argv.extend(launch.config.flags.iter().map(OsString::from));
    argv.push(boot.into_os_string());
    argv.extend(launch.args.iter().cloned());
    Ok(argv)
}

/// "Home" mode (POSIX): remove every `PYTHON*` variable so the interpreter cannot be
/// influenced by the user's environment, remember them for the bootstrap, and point
/// `PYTHONHOME` at the bundled runtime.
pub fn isolate_environment(home: &Path) {
    let mut saved = String::new();
    let mut names = Vec::new();
    for (name, value) in std::env::vars_os() {
        if is_python_variable(&name) {
            if !saved.is_empty() {
                saved.push(';');
            }
            push_hex(&mut saved, &os_bytes(&name));
            saved.push('=');
            push_hex(&mut saved, &os_bytes(&value));
            names.push(name);
        }
    }
    // SAFETY: the launcher is single-threaded and the interpreter has not been loaded yet,
    // so nothing can read the environment concurrently.
    unsafe {
        for name in &names {
            std::env::remove_var(name);
        }
        std::env::set_var(SAVED_ENV_VAR, saved);
        std::env::set_var("PYTHONHOME", home);
    }
}

/// True for variables CPython reads at startup (`PYTHON*`, `PYTHON_*`) and the macOS
/// venv launcher variable. Windows variable names are case-insensitive.
pub fn is_python_variable(name: &OsStr) -> bool {
    let bytes = os_bytes(name);
    let upper: Vec<u8> = if cfg!(windows) {
        bytes.to_ascii_uppercase()
    } else {
        bytes.into_owned()
    };
    upper.starts_with(b"PYTHON") || upper == b"__PYVENV_LAUNCHER__"
}

#[cfg(unix)]
fn os_bytes(s: &OsStr) -> std::borrow::Cow<'_, [u8]> {
    use std::os::unix::ffi::OsStrExt;
    std::borrow::Cow::Borrowed(s.as_bytes())
}

#[cfg(windows)]
fn os_bytes(s: &OsStr) -> std::borrow::Cow<'_, [u8]> {
    // Lossy only for unpaired surrogates, which cannot round-trip through UTF-8 anyway.
    std::borrow::Cow::Owned(s.to_string_lossy().into_owned().into_bytes())
}

fn push_hex(out: &mut String, bytes: &[u8]) {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 0xf) as usize] as char);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_variables_are_detected() {
        assert!(is_python_variable(OsStr::new("PYTHONPATH")));
        assert!(is_python_variable(OsStr::new("PYTHON_GIL")));
        assert!(is_python_variable(OsStr::new("__PYVENV_LAUNCHER__")));
        assert!(!is_python_variable(OsStr::new("PATH")));
        assert!(!is_python_variable(OsStr::new("MYPYTHONPATH")));
        assert_eq!(is_python_variable(OsStr::new("pythonpath")), cfg!(windows));
    }

    #[test]
    fn hex_encoding() {
        let mut s = String::new();
        push_hex(&mut s, "Aç=".as_bytes());
        assert_eq!(s, "41c3a73d");
    }

    #[test]
    fn argv_order() {
        let launch = Launch {
            exe: PathBuf::from("/x/App"),
            base: PathBuf::from("/x/res"),
            config: Config::parse("format=1\npython.lib=python/lib.so\nboot=pack/boot.py\nflag=-B\nflag=-X\nflag=utf8\n").unwrap(),
            args: vec![OsString::from("a b"), OsString::from("ç")],
        };
        let argv = interpreter_argv(&launch).unwrap();
        let boot = PathBuf::from("/x/res").join("pack").join("boot.py").into_os_string();
        assert_eq!(argv, vec![OsString::from("/x/App"), "-B".into(), "-X".into(), "utf8".into(), boot, "a b".into(), "ç".into()]);
    }
}
