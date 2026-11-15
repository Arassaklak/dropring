//! Windows: load python3XY.dll with `LoadLibraryExW` and call `Py_Main`.
//!
//! Path configuration comes from `python3XY._pth` next to the DLL (isolated mode, no
//! registry), and the builder passes `-I` so no PYTHON* variable is read at all.

use crate::{Launch, config};
use std::ffi::{OsStr, c_int, c_void};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

type Handle = *mut c_void;

/// Resolve the DLL's own dependencies (vcruntime140.dll) from the DLL's directory.
const LOAD_WITH_ALTERED_SEARCH_PATH: u32 = 0x0000_0008;
const MB_OK: u32 = 0x0000_0000;
const MB_ICONERROR: u32 = 0x0000_0010;
const MB_SETFOREGROUND: u32 = 0x0001_0000;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LoadLibraryExW(file: *const u16, reserved: Handle, flags: u32) -> Handle;
    fn GetProcAddress(module: Handle, name: *const u8) -> *mut c_void;
    fn GetLastError() -> u32;
}

#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(owner: Handle, text: *const u16, caption: *const u16, kind: u32) -> c_int;
}

/// `int Py_Main(int argc, wchar_t **argv)` — stable ABI.
type PyMain = unsafe extern "C" fn(argc: c_int, argv: *mut *mut u16) -> c_int;

pub fn run(launch: &Launch) -> Result<i32, String> {
    let library = config::resolve(&launch.base, &launch.config.python_lib)?;
    if let Some(home) = &launch.config.python_home {
        crate::isolate_environment(&config::resolve(&launch.base, home)?);
    }
    let mut argv: Vec<Vec<u16>> = crate::interpreter_argv(launch)?
        .iter()
        .map(|arg| wide(arg))
        .collect();
    let entry = load_entry(&library)?;
    let mut pointers: Vec<*mut u16> = argv.iter_mut().map(|s| s.as_mut_ptr()).collect();
    pointers.push(std::ptr::null_mut());
    let argc = c_int::try_from(argv.len()).map_err(|_| "too many arguments".to_owned())?;
    // SAFETY: `entry` is Py_Main from the bundled DLL. `pointers` is a NULL-terminated
    // array of NUL-terminated UTF-16 strings that outlive the call.
    Ok(unsafe { entry(argc, pointers.as_mut_ptr()) })
}

fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

fn load_entry(library: &Path) -> Result<PyMain, String> {
    let name = wide(library.as_os_str());
    // SAFETY: plain Win32 calls with a valid NUL-terminated wide string; the symbol is only
    // transmuted after a null check, to the documented Py_Main signature.
    unsafe {
        let module = LoadLibraryExW(name.as_ptr(), std::ptr::null_mut(), LOAD_WITH_ALTERED_SEARCH_PATH);
        if module.is_null() {
            let code = GetLastError();
            let hint = match code {
                126 => " (the file or one of its DLL dependencies is missing)",
                193 => " (the runtime was built for a different CPU architecture)",
                _ => "",
            };
            return Err(format!(
                "cannot load the Python runtime {}: Windows error {code}{hint}",
                library.display()
            ));
        }
        let symbol = GetProcAddress(module, b"Py_Main\0".as_ptr());
        if symbol.is_null() {
            return Err(format!("{} does not export Py_Main", library.display()));
        }
        Ok(std::mem::transmute::<*mut c_void, PyMain>(symbol))
    }
}

pub fn report_error(windowed: bool, message: &str) {
    let text = format!("dropring-pack launcher {}: {message}", crate::VERSION);
    if windowed {
        let caption = wide(OsStr::new("Application error"));
        let body = wide(OsStr::new(&text));
        // SAFETY: both strings are NUL-terminated and outlive the call; no owner window.
        unsafe {
            MessageBoxW(std::ptr::null_mut(), body.as_ptr(), caption.as_ptr(), MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
        }
    } else {
        eprintln!("{text}");
    }
}
