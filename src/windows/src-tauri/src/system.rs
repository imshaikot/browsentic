use serde::Serialize;
use std::path::PathBuf;

use crate::process;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Browser {
    pub name: String,
    pub path: PathBuf,
}

/// Browsers on Windows: the name shown, the program App Paths registers, and where each installs
/// itself when it does not register one, under Program Files or the user's AppData.
const BROWSERS: [(&str, &str, &str); 7] = [
    ("Google Chrome", "chrome.exe", r"Google\Chrome\Application\chrome.exe"),
    ("Microsoft Edge", "msedge.exe", r"Microsoft\Edge\Application\msedge.exe"),
    ("Brave", "brave.exe", r"BraveSoftware\Brave-Browser\Application\brave.exe"),
    ("Vivaldi", "vivaldi.exe", r"Vivaldi\Application\vivaldi.exe"),
    ("Opera", "opera.exe", r"Programs\Opera\opera.exe"),
    ("Chromium", "chromium.exe", r"Chromium\Application\chrome.exe"),
    ("Firefox", "firefox.exe", r"Mozilla Firefox\firefox.exe"),
];

pub fn browsers() -> Vec<Browser> {
    BROWSERS
        .iter()
        .filter_map(|(name, program, relative)| {
            platform::registered(program)
                .into_iter()
                .chain(install_roots().into_iter().map(|root| root.join(relative)))
                .find(|path| path.is_file())
                .map(|path| Browser { name: name.to_string(), path })
        })
        .collect()
}

fn install_roots() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].iter().filter_map(std::env::var_os).map(PathBuf::from).collect()
}

/// Chromium browsers take chrome:// from their command line on Windows, Edge and Brave included.
pub fn open_extensions_page(browser: &std::path::Path) -> Result<(), String> {
    let mut command = std::process::Command::new(browser);
    command.arg("chrome://extensions");
    command.spawn().map(drop).map_err(|error| error.to_string())
}

/// Which of these agent CLIs a terminal would find, the app's private Node folder included.
pub fn agents_on_path(bins: &[String], extra: &[PathBuf]) -> Vec<String> {
    bins.iter().filter(|bin| process::which(bin, extra).is_some()).cloned().collect()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct System {
    pub name: String,
    pub architecture: &'static str,
}

pub fn describe() -> System {
    System { name: platform::name(), architecture: if cfg!(target_arch = "aarch64") { "ARM64" } else { "x64" } }
}

/// Windows 11 still calls itself Windows 10 in ProductName; build 22000 is where 11 begins.
pub fn windows_name(product: &str, display: &str, build: u32) -> String {
    let product = if build >= 22000 { product.replacen("Windows 10", "Windows 11", 1) } else { product.to_string() };
    [product.as_str(), display].iter().filter(|part| !part.is_empty()).cloned().collect::<Vec<_>>().join(" ")
}

#[cfg(windows)]
mod platform {
    use std::path::PathBuf;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    pub fn registered(program: &str) -> Vec<PathBuf> {
        let key = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{program}");
        [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE]
            .into_iter()
            .filter_map(|hive| RegKey::predef(hive).open_subkey_with_flags(&key, KEY_READ).ok()?.get_value::<String, _>("").ok())
            .map(|path| PathBuf::from(path.trim_matches('"')))
            .collect()
    }

    pub fn name() -> String {
        let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", KEY_READ) else {
            return "Windows".into();
        };
        let read = |name: &str| key.get_value::<String, _>(name).unwrap_or_default();
        super::windows_name(&read("ProductName"), &read("DisplayVersion"), read("CurrentBuildNumber").parse().unwrap_or(0))
    }
}

#[cfg(not(windows))]
mod platform {
    use std::path::PathBuf;

    pub fn registered(_: &str) -> Vec<PathBuf> {
        Vec::new()
    }

    pub fn name() -> String {
        format!("{} (development)", std::env::consts::OS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calls_windows_11_by_its_name() {
        assert_eq!(windows_name("Windows 10 Pro", "24H2", 26100), "Windows 11 Pro 24H2");
        assert_eq!(windows_name("Windows 10 Home", "22H2", 19045), "Windows 10 Home 22H2");
        assert_eq!(windows_name("Windows 10 Pro", "", 22631), "Windows 11 Pro");
    }
}
