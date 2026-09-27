use serde::Serialize;
use tauri::{AppHandle, Emitter, Url};
use tauri_plugin_updater::{Updater, UpdaterExt};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub notes: Option<String>,
}

/// The release feed from tauri.conf.json, or another one for a test build; either way the download
/// must carry a signature from the key built into this app, or it is not installed.
fn updater(app: &AppHandle) -> Result<Updater, String> {
    let mut builder = app.updater_builder();
    if let Some(feed) = std::env::var("BROWSENTIC_UPDATE_URL").ok().and_then(|url| Url::parse(&url).ok()) {
        builder = builder.endpoints(vec![feed]).map_err(|error| error.to_string())?;
    }
    builder.build().map_err(|error| error.to_string())
}

fn explain(error: tauri_plugin_updater::Error) -> String {
    match error {
        tauri_plugin_updater::Error::Reqwest(_) | tauri_plugin_updater::Error::Network(_) => {
            "GitHub could not be reached. Check the connection and try again.".into()
        }
        tauri_plugin_updater::Error::Minisign(_) | tauri_plugin_updater::Error::SignatureUtf8(_) => {
            "The download's signature does not match this app's key, so it was not installed.".into()
        }
        other => other.to_string(),
    }
}

pub async fn check(app: &AppHandle) -> Result<Option<Release>, String> {
    let found = updater(app)?.check().await.map_err(explain)?;
    Ok(found.map(|update| Release { version: update.version.clone(), notes: update.body.clone() }))
}

/// Downloads and runs the new installer, which closes this app, replaces it, and opens it again.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let update = updater(app)?.check().await.map_err(explain)?.ok_or("There is no newer release to install.")?;
    let progress = app.clone();
    let mut received = 0u64;
    update
        .download_and_install(
            move |chunk, total| {
                received += chunk as u64;
                let _ = progress.emit("update-progress", serde_json::json!({ "received": received, "total": total }));
            },
            || {},
        )
        .await
        .map_err(explain)
}
