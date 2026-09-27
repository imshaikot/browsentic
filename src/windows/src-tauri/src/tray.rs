use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The menu-bar extra of the macOS app, as a notification-area icon: the daemon's state, turning it
/// on or off, restarting it, and the window. Closing the window leaves this running.
pub struct Tray {
    status: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
    restart: MenuItem<Wry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub summary: String,
    pub toggle: String,
    pub can_toggle: bool,
    pub can_restart: bool,
}

pub fn build(app: &AppHandle) -> tauri::Result<Tray> {
    let item = |id: &str, text: &str, enabled: bool| MenuItem::with_id(app, id, text, enabled, None::<&str>);
    let status = item("status", "Daemon: Off", false)?;
    let toggle = item("toggle", "Turn On", false)?;
    let restart = item("restart", "Restart", false)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &restart,
            &PredefinedMenuItem::separator(app)?,
            &item("open", "Open Browsentic", true)?,
            &item("quit", "Quit", true)?,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("browsentic").tooltip("Browsentic").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        "open" => show(app),
        "quit" => app.exit(0),
        action => {
            let _ = app.emit("tray", action);
        }
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            show(tray.app_handle());
        }
    })
    .build(app)?;

    Ok(Tray { status, toggle, restart })
}

impl Tray {
    pub fn apply(&self, status: &Status) -> tauri::Result<()> {
        self.status.set_text(&status.summary)?;
        self.toggle.set_text(&status.toggle)?;
        self.toggle.set_enabled(status.can_toggle)?;
        self.restart.set_enabled(status.can_restart)
    }
}

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
