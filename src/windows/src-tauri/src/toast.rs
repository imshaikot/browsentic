use url::Url;

/// Registered by the installer, so a toast's buttons reach this app whether it is running or not.
pub const SCHEME: &str = "browsentic";

/// `browsentic://<host>/<path>?…`. Any web page can open one, so whatever acts on it checks a nonce first.
pub fn link(host: &str, path: &str, query: &[(&str, &str)]) -> String {
    let mut address = Url::parse(&format!("{SCHEME}://{host}/{path}")).expect("a toast link is a valid address");
    if !query.is_empty() {
        address.query_pairs_mut().extend_pairs(query);
    }
    address.into()
}

/// 128 random bits, as hex.
pub fn mint() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Windows gave no random numbers to secure the notification with.".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub fn same_secret(held: Option<&String>, offered: &str) -> bool {
    held.is_some_and(|held| {
        !held.is_empty() && held.len() == offered.len() && held.bytes().zip(offered.bytes()).fold(0, |differs, (a, b)| differs | (a ^ b)) == 0
    })
}

/// Text for toast XML, which also refuses the control characters XML 1.0 has no place for.
pub fn escape(text: &str) -> String {
    text.chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\r' | '\t'))
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(windows)]
mod windows_toasts {
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager};

    pub fn post(app_id: &str, xml: &str, tag: Option<(&str, &str)>) -> windows::core::Result<()> {
        let content = XmlDocument::new()?;
        content.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&content)?;
        if let Some((group, tag)) = tag {
            toast.SetGroup(&HSTRING::from(group))?;
            toast.SetTag(&HSTRING::from(tag))?;
        }
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
    }

    pub fn withdraw(app_id: &str, group: &str, tag: &str) -> windows::core::Result<()> {
        ToastNotificationManager::History()?.RemoveGroupedTagWithId(&HSTRING::from(tag), &HSTRING::from(group), &HSTRING::from(app_id))
    }

    pub fn enabled(app_id: &str) -> windows::core::Result<bool> {
        Ok(ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Setting()? == NotificationSetting::Enabled)
    }
}

/// Toasts go to the identity the installer stamps on the Start menu shortcut; without that shortcut, as
/// in a development build, Windows drops them, which [`enabled`] reports.
#[cfg(windows)]
pub fn post(app_id: &str, xml: &str, tag: Option<(&str, &str)>) {
    let _ = windows_toasts::post(app_id, xml, tag);
}

#[cfg(windows)]
pub fn withdraw(app_id: &str, group: &str, tag: &str) {
    let _ = windows_toasts::withdraw(app_id, group, tag);
}

/// Whether a toast posted now would show: the app is installed under its identity and the person has not
/// turned its notifications off.
#[cfg(windows)]
pub fn enabled(app_id: &str) -> bool {
    windows_toasts::enabled(app_id).unwrap_or(false)
}

#[cfg(not(windows))]
pub fn post(_: &str, _: &str, _: Option<(&str, &str)>) {}

#[cfg(not(windows))]
pub fn withdraw(_: &str, _: &str, _: &str) {}

#[cfg(not(windows))]
pub fn enabled(_: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_markup_and_drops_what_xml_cannot_carry() {
        assert_eq!(escape("Tom & \"Jerry\" <b>'s</b>"), "Tom &amp; &quot;Jerry&quot; &lt;b&gt;&apos;s&lt;/b&gt;");
        assert_eq!(escape("price\u{0}dropped\u{1b}[0m\nto £3"), "pricedropped[0m\nto £3");
    }

    #[test]
    fn a_secret_matches_only_itself() {
        let held = "a1b2".to_string();
        assert!(same_secret(Some(&held), "a1b2"));
        assert!(!same_secret(Some(&held), "a1b3"));
        assert!(!same_secret(Some(&held), "a1b"));
        assert!(!same_secret(None, "a1b2"));
        assert!(!same_secret(Some(&String::new()), ""));
    }

    #[test]
    fn links_encode_what_they_carry() {
        assert_eq!(link("notice", "open", &[("id", "a b/c"), ("n", "x+y")]), "browsentic://notice/open?id=a+b%2Fc&n=x%2By");
        assert_eq!(link("pair", "open", &[]), "browsentic://pair/open");
    }

    #[cfg(not(windows))]
    #[test]
    fn a_build_for_another_system_never_claims_toasts_show() {
        assert!(!enabled("com.imshaikot.browsentic"));
    }
}
