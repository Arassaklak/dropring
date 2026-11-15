//! macOS / Linux: load libpython with `dlopen` and call `Py_BytesMain`.

use crate::{Launch, config};
use std::ffi::{CStr, CString, OsStr, c_char, c_int, c_void};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

const RTLD_NOW: c_int = 0x2;
#[cfg(target_os = "macos")]
const RTLD_GLOBAL: c_int = 0x8;
#[cfg(not(target_os = "macos"))]
const RTLD_GLOBAL: c_int = 0x100;

#[cfg_attr(target_os = "linux", link(name = "dl"))]
unsafe extern "C" {
    fn dlopen(filename: *const c_char, flags: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn dlerror() -> *const c_char;
}

/// `int Py_BytesMain(int argc, char **argv)` — stable ABI since CPython 3.8.
type PyBytesMain = unsafe extern "C" fn(argc: c_int, argv: *mut *mut c_char) -> c_int;

pub fn run(launch: &Launch) -> Result<i32, String> {
    let library = config::resolve(&launch.base, &launch.config.python_lib)?;
    if let Some(home) = &launch.config.python_home {
        crate::isolate_environment(&config::resolve(&launch.base, home)?);
    }
    let argv = crate::interpreter_argv(launch)?
        .iter()
        .map(|arg| c_string(arg))
        .collect::<Result<Vec<_>, _>>()?;
    let entry = load_entry(&library)?;
    let mut pointers: Vec<*mut c_char> = argv.iter().map(|s| s.as_ptr().cast_mut()).collect();
    pointers.push(std::ptr::null_mut());
    let argc = c_int::try_from(argv.len()).map_err(|_| "too many arguments".to_owned())?;
    // SAFETY: `entry` is Py_BytesMain from the bundled libpython. `pointers` is a
    // NULL-terminated array of NUL-terminated strings that outlive the call.
    Ok(unsafe { entry(argc, pointers.as_mut_ptr()) })
}

fn c_string(s: &OsStr) -> Result<CString, String> {
    CString::new(s.as_bytes()).map_err(|_| format!("argument contains a NUL byte: {s:?}"))
}

fn load_entry(library: &Path) -> Result<PyBytesMain, String> {
    let path = c_string(library.as_os_str())?;
    // SAFETY: dlopen/dlsym receive valid NUL-terminated strings; the returned symbol is
    // only transmuted after a null check, to the documented Py_BytesMain signature.
    unsafe {
        let handle = dlopen(path.as_ptr(), RTLD_NOW | RTLD_GLOBAL);
        if handle.is_null() {
            return Err(format!(
                "cannot load the Python runtime {}: {}",
                library.display(),
                last_error()
            ));
        }
        let symbol = dlsym(handle, c"Py_BytesMain".as_ptr());
        if symbol.is_null() {
            return Err(format!(
                "{} does not export Py_BytesMain (Python 3.8 or newer is required)",
                library.display()
            ));
        }
        Ok(std::mem::transmute::<*mut c_void, PyBytesMain>(symbol))
    }
}

fn last_error() -> String {
    // SAFETY: dlerror returns NULL or a NUL-terminated string valid until the next dl* call.
    unsafe {
        let message = dlerror();
        if message.is_null() {
            "unknown error".to_owned()
        } else {
            CStr::from_ptr(message).to_string_lossy().into_owned()
        }
    }
}

pub fn report_error(_windowed: bool, message: &str) {
    // M1: also show a native alert when not started from a terminal (Finder launch).
    eprintln!("dropring-pack launcher {}: {message}", crate::VERSION);
}
