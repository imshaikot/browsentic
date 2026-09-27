use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

use crate::paths::Paths;
use crate::process;

pub const MINIMUM_MAJOR: u32 = 20;
const DIST: &str = "https://nodejs.org/dist";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstall {
    pub path: PathBuf,
    pub version: String,
    pub is_private: bool,
}

impl NodeInstall {
    pub fn dir(&self) -> PathBuf {
        self.path.parent().map(Path::to_path_buf).unwrap_or_default()
    }

    /// npm's own script, so installing an agent never starts npm.cmd.
    pub fn npm_cli(&self) -> PathBuf {
        let root = if cfg!(windows) { self.dir() } else { self.dir().join("..").join("lib") };
        root.join("node_modules").join("npm").join("bin").join("npm-cli.js")
    }
}

pub fn major(version: &str) -> u32 {
    version.trim().trim_start_matches('v').split('.').next().and_then(|major| major.parse().ok()).unwrap_or(0)
}

pub fn architecture() -> &'static str {
    if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" }
}

/// The user's own Node when it is new enough, otherwise the private copy under ~/.browsentic/runtime.
pub async fn locate(paths: &Paths) -> Option<NodeInstall> {
    let candidates = [(process::which("node", &[]), false), (Some(paths.private_node()), true)];
    for (path, is_private) in candidates {
        let Some(path) = path.filter(|path| path.is_file()) else { continue };
        let Ok(output) = process::run(process::command(&path, &[]).arg("--version"), Duration::from_secs(8)).await else { continue };
        let version = output.stdout.trim().to_string();
        if output.ok && major(&version) >= MINIMUM_MAJOR {
            return Some(NodeInstall { path, version, is_private });
        }
    }
    None
}

#[derive(Deserialize)]
struct Release {
    version: String,
    files: Vec<String>,
    lts: serde_json::Value,
}

fn current_lts(releases: Vec<Release>, platform: &str) -> Option<String> {
    releases.into_iter().find(|release| release.lts.is_string() && release.files.iter().any(|file| file == platform)).map(|release| release.version)
}

fn checksum_for(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| line.strip_suffix(name)?.strip_suffix("  ").map(str::to_string))
}

/// Downloads the current LTS from nodejs.org into ~/.browsentic/runtime/node. No administrator,
/// no package manager, and nothing outside ~/.browsentic is touched.
pub async fn install_private(paths: &Paths, progress: impl Fn(f64, String)) -> Result<NodeInstall, String> {
    if !cfg!(windows) {
        return Err("The app installs its own Node.js on Windows only.".into());
    }
    let failed = |error: reqwest::Error| format!("nodejs.org could not be reached ({error}). Check the connection and try again.");
    let client = reqwest::Client::builder().user_agent("Browsentic").build().map_err(failed)?;

    progress(0.0, "Finding the current Node.js LTS".into());
    let platform = format!("win-{}-zip", architecture());
    let releases: Vec<Release> = client.get(format!("{DIST}/index.json")).send().await.and_then(|r| r.error_for_status()).map_err(failed)?.json().await.map_err(failed)?;
    let version = current_lts(releases, &platform).ok_or("nodejs.org did not list a release for this computer. Try again later.")?;
    let name = format!("node-{version}-win-{}.zip", architecture());
    let sums = client.get(format!("{DIST}/{version}/SHASUMS256.txt")).send().await.and_then(|r| r.error_for_status()).map_err(failed)?.text().await.map_err(failed)?;
    let expected = checksum_for(&sums, &name).ok_or("nodejs.org published no checksum for this download, so it was not installed.")?;

    let label = format!("Downloading Node.js {version}");
    progress(0.02, label.clone());
    tokio::fs::create_dir_all(paths.runtime()).await.map_err(|error| error.to_string())?;
    let archive = paths.runtime().join(format!("{name}.part"));
    let mut response = client.get(format!("{DIST}/{version}/{name}")).send().await.and_then(|r| r.error_for_status()).map_err(failed)?;
    let total = response.content_length().unwrap_or(0) as f64;
    let mut file = tokio::fs::File::create(&archive).await.map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut received = 0f64;
    while let Some(chunk) = response.chunk().await.map_err(failed)? {
        digest.update(&chunk);
        file.write_all(&chunk).await.map_err(|error| error.to_string())?;
        received += chunk.len() as f64;
        if total > 0.0 {
            progress(0.02 + received / total * 0.88, label.clone());
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);

    progress(0.92, "Verifying the download".into());
    let actual: String = digest.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    if actual != expected {
        let _ = std::fs::remove_file(&archive);
        return Err("The Node.js download did not match its published checksum, so it was discarded. Try again.".into());
    }

    progress(0.95, "Unpacking".into());
    let target = paths.runtime().join("node");
    let unpacked = {
        let (archive, target) = (archive.clone(), target.clone());
        tokio::task::spawn_blocking(move || unpack(&archive, &target)).await.map_err(|error| error.to_string())?
    };
    let _ = std::fs::remove_file(&archive);
    unpacked.map_err(|error| format!("Node.js downloaded but would not unpack: {error}"))?;

    progress(1.0, format!("Node.js {version} is ready"));
    Ok(NodeInstall { path: paths.private_node(), version, is_private: true })
}

/// Unpacks Node's zip without its top folder (node-v22.x-win-arm64/), then swaps it into place whole.
pub fn unpack(archive: &Path, target: &Path) -> Result<(), String> {
    let staging = target.with_file_name(format!("node.tmp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    let mut zip = zip::ZipArchive::new(File::open(archive).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
        let Some(inner) = entry.enclosed_name().map(|name| name.components().skip(1).collect::<PathBuf>()) else { continue };
        if inner.as_os_str().is_empty() {
            continue;
        }
        let out = staging.join(inner);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::io::copy(&mut entry, &mut File::create(&out).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        }
    }
    let _ = std::fs::remove_dir_all(target);
    std::fs::rename(&staging, target).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_the_major_version_as_node_prints_it() {
        assert_eq!((major("v22.11.0\n"), major("20.0.0"), major("nonsense")), (22, 20, 0));
    }

    #[test]
    fn picks_the_newest_lts_that_ships_this_platform() {
        let releases: Vec<Release> = serde_json::from_str(
            r#"[{"version":"v25.0.0","files":["win-arm64-zip"],"lts":false},
                {"version":"v24.2.0","files":["win-x64-zip"],"lts":"Krypton"},
                {"version":"v24.1.0","files":["win-arm64-zip","win-x64-zip"],"lts":"Krypton"}]"#,
        )
        .unwrap();
        assert_eq!(current_lts(releases, "win-arm64-zip"), Some("v24.1.0".into()));
    }

    #[test]
    fn finds_the_published_checksum_for_exactly_this_file() {
        let sums = "aaa  node-v24.1.0-win-x64.zip\nbbb  node-v24.1.0-win-arm64.zip\nccc  node-v24.1.0-win-arm64.zip.sig\n";
        assert_eq!(checksum_for(sums, "node-v24.1.0-win-arm64.zip"), Some("bbb".into()));
        assert_eq!(checksum_for(sums, "node-v24.1.0-win-x86.zip"), None);
    }

    #[test]
    fn unpacks_without_the_top_folder_and_replaces_what_was_there() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("node.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.add_directory("node-v24.1.0-win-arm64/", stored).unwrap();
        zip.start_file("node-v24.1.0-win-arm64/node.exe", stored).unwrap();
        zip.write_all(b"node").unwrap();
        zip.start_file("node-v24.1.0-win-arm64/node_modules/npm/bin/npm-cli.js", stored).unwrap();
        zip.write_all(b"npm").unwrap();
        zip.finish().unwrap();

        let target = dir.path().join("runtime").join("node");
        std::fs::create_dir_all(target.join("stale")).unwrap();
        unpack(&archive, &target).unwrap();

        assert_eq!(std::fs::read(target.join("node.exe")).unwrap(), b"node");
        assert!(target.join("node_modules/npm/bin/npm-cli.js").is_file());
        assert!(!target.join("stale").exists());
    }
}
