use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::node::NodeInstall;
use crate::paths::Paths;

/// The CLI, the bundled skills and the extension build, carried inside the app in the npm
/// package's layout and laid down in ~/.browsentic/cli, beside the `browsentic` launchers.
pub struct Bundle {
    pub payload: PathBuf,
    pub launcher: PathBuf,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayloadStatus {
    pub bundled: Option<String>,
    pub installed: Option<String>,
    pub current: bool,
}

#[derive(Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallStamp {
    pub version: String,
    pub installed_at: String,
}

pub fn version_at(manifest: &Path) -> Option<String> {
    let text = fs::read_to_string(manifest).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()?.get("version")?.as_str().map(str::to_string)
}

impl Bundle {
    pub fn version(&self) -> Option<String> {
        version_at(&self.payload.join("package.json"))
    }
}

/// The marker's version alone is not enough: the macOS app learned that a same-version dev build
/// installed over a release would otherwise be taken for current.
pub fn status(paths: &Paths, bundle: Option<&Bundle>) -> PayloadStatus {
    let bundled = bundle.and_then(Bundle::version);
    let installed = paths.cli_entry().is_file().then(|| version_at(&paths.cli_manifest())).flatten();
    let current = bundled.is_some() && bundled == installed && paths.app_marker().is_file();
    PayloadStatus { bundled, installed, current }
}

pub fn extension_stamp(paths: &Paths) -> Option<InstallStamp> {
    let text = fs::read_to_string(paths.extension_dir().join(".browsentic-install.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// A directory swap: the daemon has been stopped by the caller, and nothing derives an identity
/// from this path (the extension's folder is another matter, and is never moved).
pub fn install(paths: &Paths, bundle: &Bundle, node: &NodeInstall, app: &Path) -> Result<(), String> {
    let version = bundle.version().ok_or("This copy of Browsentic carries no CLI payload. Download a fresh one from browsentic.com.")?;
    let fail = |error: io::Error| error.to_string();
    fs::create_dir_all(paths.state()).map_err(fail)?;

    let pid = std::process::id();
    let staging = paths.state().join(format!("cli.tmp-{pid}"));
    let _ = fs::remove_dir_all(&staging);
    copy_dir(&bundle.payload, &staging).map_err(fail)?;
    let marker = serde_json::json!({
        "app": app,
        "installedAt": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap_or_default(),
        "node": node.path,
        "version": version,
    });
    fs::write(staging.join(".browsentic-app.json"), serde_json::to_string_pretty(&marker).unwrap_or_default()).map_err(fail)?;

    let retired = paths.state().join(format!("cli.old-{pid}"));
    if paths.cli().exists() {
        fs::rename(paths.cli(), &retired).map_err(fail)?;
    }
    fs::rename(&staging, paths.cli()).map_err(fail)?;
    let _ = fs::remove_dir_all(&retired);
    sweep(&paths.state(), "cli.old-");

    fs::create_dir_all(paths.bin()).map_err(fail)?;
    for shim in [paths.shim(), paths.mcp_shim()] {
        place(&bundle.launcher, &shim).map_err(fail)?;
    }
    sweep(&paths.bin(), ".old-");
    Ok(())
}

/// Windows will not overwrite a running program, but it will rename one, so an MCP client holding
/// the old launcher open never blocks an update. The renamed copy is swept once it has exited.
fn place(source: &Path, target: &Path) -> io::Result<()> {
    if target.exists() {
        let name = target.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        fs::rename(target, target.with_file_name(format!("{name}.old-{}", std::process::id())))?;
    }
    fs::copy(source, target).map(drop)
}

fn sweep(dir: &Path, marker: &str) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten().filter(|entry| entry.file_name().to_string_lossy().contains(marker)) {
        let path = entry.path();
        let _ = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
    }
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle(root: &Path, version: &str) -> Bundle {
        let payload = root.join("payload");
        fs::create_dir_all(payload.join("dist")).unwrap();
        fs::create_dir_all(payload.join("extension").join("chrome-mv3")).unwrap();
        fs::write(payload.join("package.json"), format!(r#"{{"name":"browsentic","version":"{version}"}}"#)).unwrap();
        fs::write(payload.join("dist").join("cli.js"), "cli").unwrap();
        let launcher = root.join("browsentic-launcher");
        fs::write(&launcher, format!("launcher {version}")).unwrap();
        Bundle { payload, launcher }
    }

    fn node() -> NodeInstall {
        NodeInstall { path: PathBuf::from("/opt/node/node"), version: "v24.1.0".into(), is_private: true }
    }

    #[test]
    fn a_fresh_install_is_current_and_marked_as_the_app_s() {
        let root = tempfile::tempdir().unwrap();
        let paths = Paths { home: root.path().join("home") };
        let bundle = bundle(root.path(), "0.8.0");
        assert_eq!(status(&paths, Some(&bundle)), PayloadStatus { bundled: Some("0.8.0".into()), installed: None, current: false });

        install(&paths, &bundle, &node(), Path::new("/Apps/Browsentic.exe")).unwrap();

        assert!(status(&paths, Some(&bundle)).current);
        let marker: serde_json::Value = serde_json::from_str(&fs::read_to_string(paths.app_marker()).unwrap()).unwrap();
        assert_eq!((marker["version"].as_str(), marker["node"].as_str()), (Some("0.8.0"), Some("/opt/node/node")));
        assert_eq!(fs::read_to_string(paths.mcp_shim()).unwrap(), "launcher 0.8.0");
    }

    #[test]
    fn the_same_version_without_the_marker_is_not_current() {
        let root = tempfile::tempdir().unwrap();
        let paths = Paths { home: root.path().join("home") };
        let bundle = bundle(root.path(), "0.8.0");
        install(&paths, &bundle, &node(), Path::new("/Apps/Browsentic.exe")).unwrap();
        fs::remove_file(paths.app_marker()).unwrap();
        assert!(!status(&paths, Some(&bundle)).current);
    }

    #[test]
    fn an_update_replaces_the_cli_and_the_launchers_and_leaves_nothing_behind() {
        let root = tempfile::tempdir().unwrap();
        let paths = Paths { home: root.path().join("home") };
        install(&paths, &bundle(&root.path().join("old"), "0.7.6"), &node(), Path::new("/a")).unwrap();
        fs::write(paths.cli().join("left-over.js"), "stale").unwrap();

        install(&paths, &bundle(&root.path().join("new"), "0.8.0"), &node(), Path::new("/a")).unwrap();

        assert_eq!(version_at(&paths.cli_manifest()), Some("0.8.0".into()));
        assert!(!paths.cli().join("left-over.js").exists());
        assert_eq!(fs::read_to_string(paths.shim()).unwrap(), "launcher 0.8.0");
        let leftovers: Vec<_> = fs::read_dir(paths.state()).unwrap().chain(fs::read_dir(paths.bin()).unwrap()).flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".old-") || name.contains("cli.old-") || name.contains("cli.tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }
}
