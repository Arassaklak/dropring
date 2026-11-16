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
    let text = format!("dropring-pack launcher {}: {message}", crate::VERSION);
    eprintln!("{text}");
    #[cfg(target_os = "macos")]
    if crate::dialogs_allowed() && alert::launched_by_launchd() {
        alert::show("This application could not start", &text);
    }
}

/// Native alert for apps started from Finder or the Dock, where stderr is invisible.
#[cfg(target_os = "macos")]
mod alert {
    use std::ffi::{c_int, c_void};

    type CFTypeRef = *const c_void;
    const UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8
    const STOP_ALERT_LEVEL: usize = 0; // kCFUserNotificationStopAlertLevel

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithBytes(alloc: CFTypeRef, bytes: *const u8, len: isize, encoding: u32, external: u8) -> CFTypeRef;
        fn CFUserNotificationDisplayAlert(
            timeout: f64, flags: usize, icon: CFTypeRef, sound: CFTypeRef, localization: CFTypeRef,
            header: CFTypeRef, message: CFTypeRef, default_button: CFTypeRef, alternate_button: CFTypeRef,
            other_button: CFTypeRef, response: *mut usize,
        ) -> i32;
        fn CFRelease(object: CFTypeRef);
    }

    unsafe extern "C" {
        fn getppid() -> c_int;
        fn isatty(fd: c_int) -> c_int;
    }

    /// True when launchd started us (double-click in Finder, Dock, `open`) and stderr is not a
    /// terminal. A parent shell or script never gets a modal dialog that would block it.
    pub fn launched_by_launchd() -> bool {
        // SAFETY: getppid and isatty have no preconditions.
        unsafe { getppid() == 1 && isatty(2) == 0 }
    }

    fn cf_string(s: &str) -> CFTypeRef {
        // SAFETY: the bytes are valid UTF-8 for the given length; a null result is handled.
        unsafe { CFStringCreateWithBytes(std::ptr::null(), s.as_ptr(), s.len() as isize, UTF8, 0) }
    }

    pub fn show(header: &str, message: &str) {
        let header = cf_string(header);
        let message = cf_string(message);
        if header.is_null() || message.is_null() {
            return;
        }
        let mut response = 0usize;
        // SAFETY: valid CFStrings, null optional arguments, response points to a local. The call
        // blocks until the user dismisses the alert (timeout 0 = no timeout).
        unsafe {
            CFUserNotificationDisplayAlert(0.0, STOP_ALERT_LEVEL, std::ptr::null(), std::ptr::null(), std::ptr::null(), header, message, std::ptr::null(), std::ptr::null(), std::ptr::null(), &mut response);
            CFRelease(header);
            CFRelease(message);
        }
    }
}
