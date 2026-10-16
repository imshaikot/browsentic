use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use url::Url;

use crate::toast::{self, escape, same_secret, SCHEME};

const GROUP: &str = "notice";
/// As many as the Bridge can still route a click for; older toasts only ignore their click.
const MOST_HELD: usize = 50;
/// Windows refuses a longer tag.
const TAG_MAX: usize = 64;

/// A monitor, a scheduled task or a timer that finished while the browser was out of sight, as much of
/// it as a toast shows.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub tone: Option<String>,
    #[serde(default)]
    pub browser: Option<String>,
}

/// A click on a notice's toast: `browsentic://notice/open?id=…&n=…`.
#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub notice: String,
    pub nonce: String,
}

pub fn parse(address: &str) -> Option<Link> {
    let url = Url::parse(address).ok()?;
    if url.scheme() != SCHEME || url.host_str() != Some("notice") || url.path().trim_end_matches('/') != "/open" {
        return None;
    }
    let take = |key: &str| url.query_pairs().find(|(name, _)| name == key).map(|(_, value)| value.into_owned()).filter(|value| !value.is_empty());
    Some(Link { notice: take("id")?, nonce: take("n").unwrap_or_default() })
}

/// The nonce minted for each notice this app posted, newest last.
#[derive(Default)]
pub struct Notices {
    held: Mutex<Vec<(String, String)>>,
}

impl Notices {
    /// A repeat of a notice replaces its toast, and its nonce with it.
    pub fn hold(&self, notice: &str) -> Result<String, String> {
        let nonce = toast::mint()?;
        let mut held = self.held.lock().unwrap();
        held.retain(|(id, _)| id != notice);
        held.push((notice.to_string(), nonce.clone()));
        let excess = held.len().saturating_sub(MOST_HELD);
        held.drain(..excess);
        Ok(nonce)
    }

    /// The notice whose tab to bring to the front, only for the nonce this app minted for it, and once.
    pub fn judge(&self, link: &Link) -> Option<String> {
        let mut held = self.held.lock().unwrap();
        let at = held.iter().position(|(id, nonce)| id == &link.notice && same_secret(Some(nonce), &link.nonce))?;
        Some(held.remove(at).0)
    }
}

pub fn tag_of(id: &str) -> String {
    if id.len() <= TAG_MAX {
        return id.to_string();
    }
    Sha256::digest(id.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn toast_xml(notice: &Notice, nonce: &str) -> String {
    let launch = toast::link("notice", "open", &[("id", &notice.id), ("n", nonce)]);
    let duration = if notice.tone.as_deref() == Some("warn") { "long" } else { "short" };
    let attribution = notice.browser.as_deref().filter(|browser| !browser.is_empty()).map(|browser| format!(r#"<text placement="attribution">{}</text>"#, escape(browser))).unwrap_or_default();
    format!(
        r#"<toast launch="{}" activationType="protocol" duration="{duration}"><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text>{attribution}</binding></visual></toast>"#,
        escape(&launch),
        escape(&notice.title),
        escape(&notice.body),
    )
}

pub fn post(app_id: &str, notice: &Notice, nonce: &str) {
    toast::post(app_id, &toast_xml(notice, nonce), Some((GROUP, &tag_of(&notice.id))));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice(id: &str) -> Notice {
        Notice { id: id.into(), title: "Price dropped".into(), body: "The jacket is £84 now.".into(), tone: None, browser: Some("Google Chrome".into()) }
    }

    #[test]
    fn reads_a_notice_link_and_nothing_else() {
        assert_eq!(parse("browsentic://notice/open?id=monitor%3A42&n=abc"), Some(Link { notice: "monitor:42".into(), nonce: "abc".into() }));
        assert_eq!(parse("browsentic://notice/open/?id=t1"), Some(Link { notice: "t1".into(), nonce: String::new() }));
        assert_eq!(parse("browsentic://notice/open?n=abc"), None);
        assert_eq!(parse("browsentic://notice/close?id=t1&n=abc"), None);
        assert_eq!(parse("browsentic://pair/open?id=t1&n=abc"), None);
        assert_eq!(parse("https://notice/open?id=t1&n=abc"), None);
    }

    #[test]
    fn a_click_reaches_the_bridge_only_with_the_nonce_minted_for_that_notice_and_only_once() {
        let notices = Notices::default();
        let first = notices.hold("n1").unwrap();
        let second = notices.hold("n2").unwrap();
        let link = |notice: &str, nonce: &str| Link { notice: notice.into(), nonce: nonce.into() };

        assert_eq!(notices.judge(&link("n1", &second)), None);
        assert_eq!(notices.judge(&link("n1", "")), None);
        assert_eq!(notices.judge(&link("n3", &first)), None);
        assert_eq!(notices.judge(&link("n1", &first)), Some("n1".into()));
        assert_eq!(notices.judge(&link("n1", &first)), None);
        assert_eq!(notices.judge(&link("n2", &second)), Some("n2".into()));
    }

    #[test]
    fn a_repeat_replaces_the_nonce_and_only_the_newest_are_kept() {
        let notices = Notices::default();
        let stale = notices.hold("n1").unwrap();
        let fresh = notices.hold("n1").unwrap();
        assert_eq!(notices.judge(&Link { notice: "n1".into(), nonce: stale }), None);
        assert_eq!(notices.judge(&Link { notice: "n1".into(), nonce: fresh }), Some("n1".into()));

        let oldest = notices.hold("first").unwrap();
        for index in 0..MOST_HELD {
            notices.hold(&format!("later-{index}")).unwrap();
        }
        assert_eq!(notices.judge(&Link { notice: "first".into(), nonce: oldest }), None);
    }

    #[test]
    fn a_long_id_gets_a_tag_windows_accepts_and_the_same_one_each_time() {
        assert_eq!(tag_of("monitor:42"), "monitor:42");
        let long = "x".repeat(120);
        assert_eq!(tag_of(&long).len(), TAG_MAX);
        assert_eq!(tag_of(&long), tag_of(&long));
        assert_ne!(tag_of(&long), tag_of(&"y".repeat(120)));
    }

    #[test]
    fn the_toast_escapes_what_the_page_wrote_and_names_the_browser() {
        let xml = toast_xml(&Notice { title: "<b>Sold out</b> & gone".into(), body: "\"Size M\" isn't left".into(), ..notice("monitor:7") }, "n0nce");
        assert!(xml.contains(r#"launch="browsentic://notice/open?id=monitor%3A7&amp;n=n0nce""#));
        assert!(xml.contains("<text>&lt;b&gt;Sold out&lt;/b&gt; &amp; gone</text>"));
        assert!(xml.contains("<text>&quot;Size M&quot; isn&apos;t left</text>"));
        assert!(xml.contains(r#"<text placement="attribution">Google Chrome</text>"#));
        assert!(xml.contains(r#"duration="short""#));
        assert!(!xml.contains("<actions>"));

        let warning = toast_xml(&Notice { tone: Some("warn".into()), browser: None, ..notice("t1") }, "n");
        assert!(warning.contains(r#"duration="long""#));
        assert!(!warning.contains("attribution"));
    }

    #[test]
    fn decodes_a_queued_notice_and_ignores_what_a_toast_does_not_show() {
        let decoded: Vec<Notice> = serde_json::from_value(serde_json::json!([
            { "id": "t1", "kind": "timer", "title": "Timer done", "body": "Tea", "tone": "live", "at": 1, "browser": "Brave" },
            { "id": "m1", "title": "Changed" }
        ]))
        .unwrap();
        assert_eq!(decoded[0], Notice { id: "t1".into(), title: "Timer done".into(), body: "Tea".into(), tone: Some("live".into()), browser: Some("Brave".into()) });
        assert_eq!(decoded[1], Notice { id: "m1".into(), title: "Changed".into(), body: String::new(), tone: None, browser: None });
    }
}
