use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const NODE: &str = if cfg!(windows) { "node.exe" } else { "node" };
const MISSING_NODE: &str =
    "browsentic: Node.js 20 or newer is missing. Open the Browsentic app and it will install it.";

fn main() {
    let Some(state) = home().map(|home| home.join(".browsentic")) else {
        fail("browsentic: cannot find your home folder.")
    };
    let Some(node) = node(&state) else { fail(MISSING_NODE) };

    let mut args: Vec<OsString> = env::args_os().skip(1).collect();
    if args.is_empty() && invoked_as("browsentic-mcp") {
        args.push("mcp".into());
    }

    let mut child = Command::new(&node)
        .arg(state.join("cli").join("dist").join("cli.js"))
        .args(args)
        .spawn()
        .unwrap_or_else(|error| fail(&format!("browsentic: could not start {}: {error}", node.display())));
    platform::hand_over(&child);

    let status = child.wait().unwrap_or_else(|error| fail(&format!("browsentic: {error}")));
    std::process::exit(status.code().unwrap_or(1));
}

fn home() -> Option<PathBuf> {
    env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// The Node the app recorded when it installed the CLI, then its private copy, then the user's own.
fn node(state: &Path) -> Option<PathBuf> {
    let recorded = fs::read_to_string(state.join("cli").join(".browsentic-app.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|marker| marker.get("node")?.as_str().map(PathBuf::from));
    let private = state.join("runtime").join("node").join(if cfg!(windows) { NODE } else { "bin/node" });
    [recorded, Some(private)]
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
        .or_else(|| env::split_paths(&env::var_os("PATH")?).map(|dir| dir.join(NODE)).find(|path| path.is_file()))
}

fn invoked_as(name: &str) -> bool {
    env::args_os()
        .next()
        .map(PathBuf::from)
        .and_then(|path| path.file_stem().map(|stem| stem.to_string_lossy().eq_ignore_ascii_case(name)))
        .unwrap_or(false)
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(127)
}

#[cfg(windows)]
mod platform {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::System::Console::SetConsoleCtrlHandler;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
    };

    /// Windows has no exec: Node stays this process's child. A job kills it with us, so a client
    /// that ends the launcher never leaves Node running, while everything Node starts (the daemon,
    /// an agent) breaks away and lives its own life. Ctrl+C is left to Node, which also receives it.
    pub fn hand_over(child: &Child) {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if !job.is_null() {
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags =
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                AssignProcessToJobObject(job, child.as_raw_handle() as _);
            }
            SetConsoleCtrlHandler(None, 1);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn hand_over(_: &std::process::Child) {}
}
