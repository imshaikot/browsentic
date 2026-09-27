use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

use crate::path_env;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// The folders a terminal opened right now would search: the registry's, not the ones this process
/// started with, so an agent installed while the app was open is found without restarting it.
pub fn search_path(extra: &[PathBuf]) -> Vec<PathBuf> {
    let inherited: Vec<PathBuf> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
    extra.iter().cloned().chain(path_env::fresh_path()).chain(inherited).collect()
}

/// A child that never opens a console window and dies with its future.
pub fn command(program: impl AsRef<OsStr>, extra_path: &[PathBuf]) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    if let Ok(path) = std::env::join_paths(search_path(extra_path)) {
        command.env("PATH", path);
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub async fn run(command: &mut Command, timeout: Duration) -> Result<Output, String> {
    let child = command.spawn().map_err(|error| error.to_string())?;
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => Ok(Output {
            ok: output.status.success(),
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err(format!("It did not finish within {} seconds, so it was stopped.", timeout.as_secs())),
    }
}

/// `name` as a terminal would resolve it, trying each PATHEXT extension on Windows.
pub fn which(name: &str, extra: &[PathBuf]) -> Option<PathBuf> {
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|extension| !extension.is_empty())
            .map(str::to_lowercase)
            .collect()
    } else {
        vec![String::new()]
    };
    search_path(extra)
        .into_iter()
        .flat_map(|dir| extensions.iter().map(move |extension| dir.join(format!("{name}{extension}"))))
        .find(|candidate| is_program(candidate))
}

fn is_program(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata().map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn reports_what_a_program_printed_and_how_it_ended() {
        let output = run(command("sh", &[]).args(["-c", "echo out; echo err >&2; exit 3"]), Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!((output.ok, output.code, output.stdout.trim(), output.stderr.trim()), (false, Some(3), "out", "err"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stops_a_program_that_outlives_its_timeout() {
        let error = run(command("sh", &[]).args(["-c", "sleep 5"]), Duration::from_millis(200)).await.unwrap_err();
        assert!(error.contains("did not finish"));
    }

    #[test]
    fn finds_a_program_in_an_extra_folder_first() {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join(if cfg!(windows) { "browsentic-probe.cmd" } else { "browsentic-probe" });
        std::fs::write(&program, "").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&program, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let extra = [dir.path().to_path_buf()];
        assert_eq!(which("browsentic-probe", &extra).map(|found| found.to_string_lossy().to_lowercase()), Some(program.to_string_lossy().to_lowercase()));
        assert_eq!(which("browsentic-probe-missing", &extra), None);
    }
}
