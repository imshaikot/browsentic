use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The menu-bar extra of the macOS app, as a notification-area icon: the daemon's state, a browser
/// waiting to be let in, turning it on or off, restarting it, and the window. Closing the window
/// leaves this running.
pub struct Tray {
    icon: TrayIcon<Wry>,
    plain: Option<Image<'static>>,
    dotted: Option<Image<'static>>,
    status: MenuItem<Wry>,
    request: MenuItem<Wry>,
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
    pub waiting: Option<String>,
}

const NOBODY_WAITING: &str = "No browser waiting";

pub fn build(app: &AppHandle) -> tauri::Result<Tray> {
    let item = |id: &str, text: &str, enabled: bool| MenuItem::with_id(app, id, text, enabled, None::<&str>);
    let status = item("status", "Daemon: Off", false)?;
    let request = item("request", NOBODY_WAITING, false)?;
    let toggle = item("toggle", "Turn On", false)?;
    let restart = item("restart", "Restart", false)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &request,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &restart,
            &PredefinedMenuItem::separator(app)?,
            &item("open", "Open Browsentic", true)?,
            &item("quit", "Quit", true)?,
        ],
    )?;

    let plain = app.default_window_icon().map(|icon| icon.clone().to_owned());
    let dotted = plain.as_ref().map(|icon| Image::new_owned(with_dot(icon.rgba(), icon.width(), icon.height()), icon.width(), icon.height()));
    let mut tray = TrayIconBuilder::with_id("browsentic").tooltip("Browsentic").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = &plain {
        tray = tray.icon(icon.clone());
    }
    let icon = tray
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" | "request" => show(app),
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

    Ok(Tray { icon, plain, dotted, status, request, toggle, restart })
}

impl Tray {
    pub fn apply(&self, status: &Status) -> tauri::Result<()> {
        self.status.set_text(&status.summary)?;
        self.request.set_text(status.waiting.as_deref().unwrap_or(NOBODY_WAITING))?;
        self.request.set_enabled(status.waiting.is_some())?;
        self.icon.set_tooltip(Some(status.waiting.as_deref().map_or("Browsentic".to_string(), |waiting| format!("Browsentic: {waiting}"))))?;
        self.icon.set_icon(if status.waiting.is_some() { self.dotted.clone() } else { self.plain.clone() })?;
        self.toggle.set_text(&status.toggle)?;
        self.toggle.set_enabled(status.can_toggle)?;
        self.restart.set_enabled(status.can_restart)
    }
}

const DOT: [u8; 4] = [0xF2, 0x7A, 0x3C, 0xFF];

/// The icon with an ember dot in its top-right corner, ringed in transparency so it reads on any taskbar.
pub fn with_dot(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut pixels = rgba.to_vec();
    let radius = width.min(height) as f32 * 0.22;
    let (cx, cy) = (width as f32 - radius - 0.5, radius + 0.5);
    for y in 0..height {
        for x in 0..width {
            let distance = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            let at = ((y * width + x) * 4) as usize;
            if distance <= radius {
                pixels[at..at + 4].copy_from_slice(&DOT);
            } else if distance <= radius + width as f32 * 0.06 {
                pixels[at + 3] = 0;
            }
        }
    }
    pixels
}

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dot_sits_in_the_top_right_corner_and_leaves_the_rest_of_the_icon_alone() {
        let icon = vec![9u8; 32 * 32 * 4];
        let dotted = with_dot(&icon, 32, 32);
        let pixel = |x: usize, y: usize| &dotted[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4];
        assert_eq!(pixel(25, 6), DOT);
        assert_eq!(pixel(4, 28), [9, 9, 9, 9]);
        assert_eq!(pixel(6, 6), [9, 9, 9, 9]);
        assert_eq!(dotted.len(), icon.len());
    }
}
