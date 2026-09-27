#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod control;
mod node;
mod path_env;
mod paths;
mod payload;
mod process;
mod system;
mod tray;
mod update;

use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tokio::sync::Mutex;

use node::NodeInstall;

struct App {
    paths: paths::Paths,
    control: control::Control,
    node: Mutex<Option<NodeInstall>>,
}

type Result<T> = std::result::Result<T, String>;

const LOG_TAIL: u64 = 96_000;

fn bundle(app: &AppHandle) -> Option<payload::Bundle> {
    let resources = app.path().resource_dir().ok()?;
    let bundle = payload::Bundle {
        payload: resources.join("payload"),
        launcher: resources.join("launcher").join(format!("browsentic{}", std::env::consts::EXE_SUFFIX)),
    };
    bundle.payload.join("package.json").is_file().then_some(bundle)
}

async fn located(state: &App) -> Result<NodeInstall> {
    state.node.lock().await.clone().ok_or_else(|| "Node.js has to be installed first.".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    system: system::System,
    paths: paths::PathsView,
    payload: payload::PayloadStatus,
}

#[tauri::command]
fn app_info(app: AppHandle, state: State<'_, App>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        system: system::describe(),
        paths: state.paths.view(),
        payload: payload::status(&state.paths, bundle(&app).as_ref()),
    }
}

#[tauri::command]
async fn locate_node(state: State<'_, App>) -> Result<Option<NodeInstall>> {
    let found = node::locate(&state.paths).await;
    *state.node.lock().await = found.clone();
    Ok(found)
}

#[tauri::command]
async fn install_node(app: AppHandle, state: State<'_, App>) -> Result<NodeInstall> {
    let installed = node::install_private(&state.paths, |fraction, label| {
        let _ = app.emit("node-progress", serde_json::json!({ "fraction": fraction, "label": label }));
    })
    .await?;
    *state.node.lock().await = Some(installed.clone());
    Ok(installed)
}

#[tauri::command]
async fn install_payload(app: AppHandle, state: State<'_, App>) -> Result<()> {
    let node = located(&state).await?;
    let bundle = bundle(&app).ok_or("This copy of Browsentic carries no CLI payload. Download a fresh one from browsentic.com.")?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let paths = state.paths.clone();
    tauri::async_runtime::spawn_blocking(move || payload::install(&paths, &bundle, &node, &executable)).await.map_err(|error| error.to_string())?
}

/// Everything the control socket does not carry goes through the installed command, so the app and
/// a terminal never disagree about what an operation does. It starts from the home folder, which the
/// daemon it may start inherits, so no install folder is ever held open.
#[tauri::command]
async fn cli(state: State<'_, App>, args: Vec<String>, timeout_secs: Option<u64>) -> Result<process::Output> {
    let node = located(&state).await?;
    let mut command = process::command(&node.path, &[node.dir()]);
    command.arg(state.paths.cli_entry()).args(&args).current_dir(&state.paths.home);
    process::run(&mut command, Duration::from_secs(timeout_secs.unwrap_or(90))).await
}

#[tauri::command]
async fn npm_install(state: State<'_, App>, package: String) -> Result<process::Output> {
    let node = located(&state).await?;
    let mut command = process::command(&node.path, &[node.dir()]);
    command.arg(node.npm_cli()).args(["install", "--global", &package]).current_dir(&state.paths.home);
    process::run(&mut command, Duration::from_secs(600)).await
}

#[tauri::command]
fn extension_stamp(state: State<'_, App>) -> Option<payload::InstallStamp> {
    payload::extension_stamp(&state.paths)
}

#[tauri::command]
fn browsers() -> Vec<system::Browser> {
    system::browsers()
}

#[tauri::command]
fn open_extensions_page(path: PathBuf) -> Result<()> {
    system::open_extensions_page(&path)
}

#[tauri::command]
async fn agents_on_path(state: State<'_, App>, bins: Vec<String>) -> Result<Vec<String>> {
    let extra: Vec<PathBuf> = state.node.lock().await.iter().map(NodeInstall::dir).collect();
    Ok(system::agents_on_path(&bins, &extra))
}

#[tauri::command]
fn read_lock(state: State<'_, App>) -> Option<control::Lockfile> {
    control::read_lock(&state.paths)
}

/// The end of the daemon's log, starting on a whole line.
#[tauri::command]
fn log_tail(state: State<'_, App>) -> String {
    let Ok(mut file) = std::fs::File::open(state.paths.log()) else { return String::new() };
    let size = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let from = size.saturating_sub(LOG_TAIL);
    let mut bytes = Vec::new();
    if file.seek(SeekFrom::Start(from)).and_then(|_| file.read_to_end(&mut bytes)).is_err() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    match (from > 0).then(|| text.find('\n')).flatten() {
        Some(newline) => text[newline + 1..].to_string(),
        None => text.into_owned(),
    }
}

#[tauri::command]
fn command_link(state: State<'_, App>) -> path_env::CommandLink {
    path_env::command_link(&state.paths.bin())
}

#[tauri::command]
fn set_command_link(state: State<'_, App>, on: bool) -> Result<path_env::CommandLink> {
    let bin = state.paths.bin();
    if on { path_env::link(&bin)? } else { path_env::unlink(&bin)? }
    Ok(path_env::command_link(&bin))
}

#[tauri::command]
async fn control_connect(app: AppHandle, state: State<'_, App>) -> Result<bool> {
    let lock = control::read_lock(&state.paths).ok_or(control::OFFLINE)?;
    state.control.connect(lock, move |event| {
        let _ = app.emit("control-event", event);
    })
    .await
}

#[tauri::command]
async fn control_request(state: State<'_, App>, frame: Value, timeout_ms: Option<u64>) -> Result<Value> {
    state.control.request(frame, Duration::from_millis(timeout_ms.unwrap_or(10_000))).await
}

#[tauri::command]
async fn control_close(state: State<'_, App>) -> Result<()> {
    state.control.close().await;
    Ok(())
}

#[tauri::command]
fn tray_status(tray: State<'_, tray::Tray>, status: tray::Status) -> Result<()> {
    tray.apply(&status).map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<update::Release>> {
    update::check(&app).await
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<()> {
    update::install(&app).await
}

/// Run by the uninstaller before the app's files go: stop the daemon and take browsentic off the PATH.
fn prepare_uninstall() {
    let paths = paths::Paths::from_env();
    if paths.shim().is_file() {
        let mut stop = std::process::Command::new(paths.shim());
        stop.arg("stop").current_dir(&paths.home);
        #[cfg(windows)]
        std::os::windows::process::CommandExt::creation_flags(&mut stop, 0x0800_0000);
        let _ = stop.status();
    }
    let _ = path_env::unlink(&paths.bin());
}

fn main() {
    if std::env::args().any(|arg| arg == "--uninstall") {
        return prepare_uninstall();
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(App { paths: paths::Paths::from_env(), control: control::Control::default(), node: Mutex::default() })
        .setup(|app| {
            let tray = tray::build(app.handle())?;
            app.manage(tray);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            agents_on_path,
            app_info,
            browsers,
            check_update,
            cli,
            command_link,
            control_close,
            control_connect,
            control_request,
            extension_stamp,
            install_node,
            install_payload,
            install_update,
            locate_node,
            log_tail,
            npm_install,
            open_extensions_page,
            read_lock,
            set_command_link,
            tray_status,
        ])
        .run(tauri::generate_context!())
        .expect("Browsentic could not start");
}
