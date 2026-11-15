//! `dropring-pack.cfg`: UTF-8 `key=value` lines, `#` comments, written by the builder.
//!
//! ```text
//! format=1
//! python.lib=python/python314.dll     shared library to load (relative path)
//! python.home=python                  optional: POSIX "home" mode, becomes PYTHONHOME
//! boot=pack/boot.py                   bootstrap script run as the interpreter's main script
//! flag=-I                             interpreter flag, repeatable, kept in order
//! ```
//!
//! Unknown keys are ignored so newer builders can add optional settings; a higher
//! `format` number means the launcher is too old and must be rebuilt.

use std::path::{Path, PathBuf};

/// Highest config format this launcher understands.
pub const SUPPORTED_FORMAT: u32 = 1;

#[derive(Debug, Default, PartialEq)]
pub struct Config {
    pub python_lib: String,
    pub python_home: Option<String>,
    pub boot: String,
    pub flags: Vec<String>,
}

impl Config {
    pub fn parse(text: &str) -> Result<Config, String> {
        let mut config = Config::default();
        let mut format = None;
        for (index, raw) in text.lines().enumerate() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let (key, value) = line
                .split_once('=')
                .ok_or_else(|| format!("config line {}: expected key=value", index + 1))?;
            let value = value.trim();
            match key.trim() {
                "format" => {
                    format = Some(value.parse::<u32>().map_err(|_| {
                        format!("config line {}: invalid format number", index + 1)
                    })?)
                }
                "python.lib" => config.python_lib = value.to_owned(),
                "python.home" => config.python_home = Some(value.to_owned()),
                "boot" => config.boot = value.to_owned(),
                "flag" => config.flags.push(value.to_owned()),
                _ => {}
            }
        }
        match format {
            Some(SUPPORTED_FORMAT) => {}
            Some(other) => {
                return Err(format!(
                    "config format {other} is newer than this launcher supports \
                     ({SUPPORTED_FORMAT}); rebuild the application"
                ));
            }
            None => return Err("config has no format line".to_owned()),
        }
        if config.python_lib.is_empty() {
            return Err("config is missing python.lib".to_owned());
        }
        if config.boot.is_empty() {
            return Err("config is missing boot".to_owned());
        }
        Ok(config)
    }
}

/// Joins a config-relative path (forward slashes) to `base`, refusing anything that could
/// point outside the bundle: absolute paths, drive letters, `.`/`..` and empty components.
pub fn resolve(base: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err("empty path in config".to_owned());
    }
    let mut out = base.to_path_buf();
    for part in relative.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':']) {
            return Err(format!("invalid path in config: {relative}"));
        }
        out.push(part);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# comment\nformat=1\npython.lib=python/lib/libpython3.14.dylib\n\
        python.home=python\nboot=pack/boot.py\nflag=-s\nflag=-X\nflag=utf8\nfuture.key=ignored\n";

    #[test]
    fn parses_sample() {
        let c = Config::parse(SAMPLE).unwrap();
        assert_eq!(c.python_lib, "python/lib/libpython3.14.dylib");
        assert_eq!(c.python_home.as_deref(), Some("python"));
        assert_eq!(c.boot, "pack/boot.py");
        assert_eq!(c.flags, ["-s", "-X", "utf8"]);
    }

    #[test]
    fn rejects_newer_format_and_missing_keys() {
        assert!(Config::parse("format=2\npython.lib=a\nboot=b\n").unwrap_err().contains("newer"));
        assert!(Config::parse("python.lib=a\nboot=b\n").is_err());
        assert!(Config::parse("format=1\nboot=b\n").is_err());
        assert!(Config::parse("format=1\npython.lib=a\n").is_err());
        assert!(Config::parse("format=1\nnot a pair\n").is_err());
    }

    #[test]
    fn resolve_rejects_escapes() {
        let base = Path::new("base");
        assert_eq!(resolve(base, "python/x.dll").unwrap(), base.join("python").join("x.dll"));
        for bad in ["", "/abs", "../x", "a/../b", "a//b", "./a", "C:/x", "a\\b"] {
            assert!(resolve(base, bad).is_err(), "{bad} should be rejected");
        }
    }
}
