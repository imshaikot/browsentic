use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::paths::same_dir;

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommandLink {
    /// The folder on the user's PATH that holds our `browsentic`, when there is one.
    pub linked_in: Option<PathBuf>,
    /// A `browsentic` that is on the PATH but is not ours: an npm global, or a checkout's link.
    pub foreign: Option<PathBuf>,
}

pub fn command_link(bin: &Path) -> CommandLink {
    let linked_in = user_path().into_iter().find(|dir| same_dir(dir, bin));
    let foreign = fresh_path()
        .into_iter()
        .filter(|dir| !same_dir(dir, bin))
        .flat_map(|dir| ["browsentic.exe", "browsentic.cmd", "browsentic.ps1", "browsentic"].map(|name| dir.join(name)))
        .find(|candidate| candidate.is_file());
    CommandLink { linked_in, foreign }
}

/// Splits a PATH value, keeping every entry exactly as written so a rewrite changes only ours.
pub fn entries(value: &str) -> Vec<&str> {
    value.split(';').filter(|entry| !entry.trim().is_empty()).collect()
}

pub fn with_dir(value: &str, dir: &Path) -> String {
    let mut kept: Vec<String> = without(value, dir);
    kept.push(dir.to_string_lossy().into_owned());
    kept.join(";")
}

pub fn without_dir(value: &str, dir: &Path) -> String {
    without(value, dir).join(";")
}

fn without(value: &str, dir: &Path) -> Vec<String> {
    entries(value).into_iter().filter(|entry| !same_dir(Path::new(entry), dir)).map(str::to_string).collect()
}

#[cfg(windows)]
mod registry {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WRITE, REG_EXPAND_SZ};
    use winreg::{RegKey, RegValue};

    const USER: &str = "Environment";
    const SYSTEM: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

    fn read(hive: RegKey, key: &str) -> String {
        hive.open_subkey_with_flags(key, KEY_READ).and_then(|key| key.get_value::<String, _>("Path")).unwrap_or_default()
    }

    pub fn user_raw() -> String {
        read(RegKey::predef(HKEY_CURRENT_USER), USER)
    }

    pub fn system_raw() -> String {
        read(RegKey::predef(HKEY_LOCAL_MACHINE), SYSTEM)
    }

    /// REG_EXPAND_SZ, as Windows itself writes it, so entries like %USERPROFILE% keep expanding.
    pub fn write_user(value: &str) -> Result<(), String> {
        let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(USER, KEY_READ | KEY_WRITE).map_err(|error| error.to_string())?;
        let bytes: Vec<u8> = value.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
        key.set_raw_value("Path", &RegValue { bytes: bytes.into(), vtype: REG_EXPAND_SZ }).map_err(|error| error.to_string())?;
        announce();
        Ok(())
    }

    pub fn expand(value: &str) -> String {
        use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
        let wide: Vec<u16> = value.encode_utf16().chain([0]).collect();
        let needed = unsafe { ExpandEnvironmentStringsW(wide.as_ptr(), std::ptr::null_mut(), 0) };
        if needed == 0 {
            return value.to_string();
        }
        let mut buffer = vec![0u16; needed as usize];
        let written = unsafe { ExpandEnvironmentStringsW(wide.as_ptr(), buffer.as_mut_ptr(), needed) };
        String::from_utf16_lossy(&buffer[..written.saturating_sub(1) as usize])
    }

    /// Tells Explorer, and every terminal it opens from now on, that the environment changed.
    fn announce() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};
        let area: Vec<u16> = "Environment".encode_utf16().chain([0]).collect();
        unsafe {
            SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, area.as_ptr() as isize, SMTO_ABORTIFHUNG, 3000, std::ptr::null_mut());
        }
    }
}

#[cfg(windows)]
pub fn user_path() -> Vec<PathBuf> {
    entries(&registry::user_raw()).into_iter().map(|entry| PathBuf::from(registry::expand(entry))).collect()
}

#[cfg(windows)]
pub fn fresh_path() -> Vec<PathBuf> {
    [registry::system_raw(), registry::user_raw()]
        .iter()
        .flat_map(|value| entries(value).into_iter().map(|entry| PathBuf::from(registry::expand(entry))).collect::<Vec<_>>())
        .collect()
}

#[cfg(windows)]
pub fn link(bin: &Path) -> Result<(), String> {
    registry::write_user(&with_dir(&registry::user_raw(), bin))
}

#[cfg(windows)]
pub fn unlink(bin: &Path) -> Result<(), String> {
    let current = registry::user_raw();
    let next = without_dir(&current, bin);
    if next == current { Ok(()) } else { registry::write_user(&next) }
}

#[cfg(not(windows))]
pub fn user_path() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn fresh_path() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn link(_: &Path) -> Result<(), String> {
    Err("Putting browsentic on the PATH is done on Windows only.".into())
}

#[cfg(not(windows))]
pub fn unlink(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_our_folder_once_and_leaves_every_other_entry_as_written() {
        let bin = Path::new(r"C:\Users\me\.browsentic\bin");
        let before = r"%USERPROFILE%\AppData\Local\Microsoft\WindowsApps;C:\tools;";
        let after = with_dir(before, bin);
        assert_eq!(after, r"%USERPROFILE%\AppData\Local\Microsoft\WindowsApps;C:\tools;C:\Users\me\.browsentic\bin");
        assert_eq!(with_dir(&after, bin), after);
        assert_eq!(entries(&with_dir(r"C:\USERS\ME\.BROWSENTIC\BIN", bin)), vec![r"C:\Users\me\.browsentic\bin"]);
    }

    #[test]
    fn removes_only_our_folder() {
        let bin = Path::new(r"C:\Users\me\.browsentic\bin");
        assert_eq!(without_dir(r"C:\tools;c:\users\me\.browsentic\bin\;D:\x", bin), r"C:\tools;D:\x");
        assert_eq!(without_dir(r"C:\tools", bin), r"C:\tools");
    }
}
