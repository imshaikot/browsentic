use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use url::Url;

/// Registered by the installer, so a toast's buttons reach this app whether it is running or not.
pub const SCHEME: &str = "browsentic";

/// What a `browsentic://pair/…` link asks for. Any web page can open one, so none of this is trusted
/// until [`Held::act`] has matched its nonce.
#[derive(Debug, Clone, PartialEq)]
pub enum Link {
    Decide { request: String, nonce: String, allow: bool },
    Unpair { session: String, nonce: String },
    Open { request: Option<String> },
}

pub fn parse(address: &str) -> Option<Link> {
    let url = Url::parse(address).ok()?;
    if url.scheme() != SCHEME || url.host_str() != Some("pair") {
        return None;
    }
    let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let take = |key: &str| query.get(key).filter(|value| !value.is_empty()).cloned();
    let nonce = take("n").unwrap_or_default();
    match url.path().trim_end_matches('/') {
        "/allow" => Some(Link::Decide { request: take("r")?, nonce, allow: true }),
        "/deny" => Some(Link::Decide { request: take("r")?, nonce, allow: false }),
        "/unpair" => Some(Link::Unpair { session: take("s")?, nonce }),
        "/open" => Some(Link::Open { request: take("r") }),
        _ => None,
    }
}

/// What the window does with a link once it has been judged.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Act {
    Decide { request: String, allow: bool },
    Unpair { session: String },
    Show { request: Option<String> },
    Browsers,
}

impl Act {
    pub fn opens_window(&self) -> bool {
        matches!(self, Act::Show { .. } | Act::Browsers)
    }
}

/// A pending request as the Bridge lists it; the nonce reached only approvers such as this app.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub id: String,
    pub browser: Option<String>,
    pub nonce: String,
}

/// The nonces this app can vouch for: the Bridge's for each pending request, and its own for each
/// browser it announced as paired by itself.
#[derive(Default)]
pub struct Held {
    requests: Option<HashMap<String, String>>,
    sessions: HashMap<String, String>,
}

impl Held {
    /// A link decides or unpairs only with the nonce held for it; any other link just opens the window.
    /// None until the pending list has been read, so a link that started the app waits for it.
    pub fn act(&self, link: &Link) -> Option<Act> {
        Some(match link {
            Link::Decide { request, nonce, allow } => match &self.requests {
                None => return None,
                Some(requests) if same_secret(requests.get(request), nonce) => Act::Decide { request: request.clone(), allow: *allow },
                Some(_) => Act::Show { request: Some(request.clone()) },
            },
            Link::Unpair { session, nonce } if same_secret(self.sessions.get(session), nonce) => Act::Unpair { session: session.clone() },
            Link::Unpair { .. } => Act::Browsers,
            Link::Open { request } => Act::Show { request: request.clone() },
        })
    }
}

fn same_secret(held: Option<&String>, offered: &str) -> bool {
    held.is_some_and(|held| {
        !held.is_empty() && held.len() == offered.len() && held.bytes().zip(offered.bytes()).fold(0, |differs, (a, b)| differs | (a ^ b)) == 0
    })
}

/// What changed since the last list: toasts to post and to take back, and links that were waiting for it.
#[derive(Debug, Default, PartialEq)]
pub struct Change {
    pub added: Vec<Request>,
    pub removed: Vec<String>,
    pub released: Vec<Act>,
}

/// Links that arrive before the pending list are kept for it, but only a few: any web page can send them.
const MOST_WAITING: usize = 8;
/// Requests already announced, so one that is listed again after the Bridge dropped away is not.
const MOST_ANNOUNCED: usize = 50;

#[derive(Default)]
pub struct Pairing {
    held: Mutex<Held>,
    waiting: Mutex<Vec<Link>>,
    announced: Mutex<VecDeque<String>>,
}

impl Pairing {
    pub fn list(&self, requests: &[Request]) -> Change {
        let mut held = self.held.lock().unwrap();
        let before = held.requests.take().unwrap_or_default();
        let now: HashMap<String, String> = requests.iter().map(|request| (request.id.clone(), request.nonce.clone())).collect();
        let mut announced = self.announced.lock().unwrap();
        let added: Vec<Request> = requests.iter().filter(|request| !before.contains_key(&request.id) && !announced.contains(&request.id)).cloned().collect();
        announced.extend(added.iter().map(|request| request.id.clone()));
        let excess = announced.len().saturating_sub(MOST_ANNOUNCED);
        announced.drain(..excess);
        let removed = before.keys().filter(|id| !now.contains_key(*id)).cloned().collect();
        held.requests = Some(now);
        let released = self.waiting.lock().unwrap().drain(..).filter_map(|link| held.act(&link)).collect();
        Change { added, removed, released }
    }

    /// None when the link has to wait for the pending list.
    pub fn judge(&self, link: Link) -> Option<Act> {
        let act = self.held.lock().unwrap().act(&link);
        let mut waiting = self.waiting.lock().unwrap();
        if act.is_none() && waiting.len() < MOST_WAITING {
            waiting.push(link);
        }
        act
    }

    pub fn vouch_for(&self, session: &str) -> Result<String, String> {
        let nonce = mint()?;
        self.held.lock().unwrap().sessions.insert(session.to_string(), nonce.clone());
        Ok(nonce)
    }
}

fn mint() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Windows gave no random numbers to secure the notification with.".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn link(path: &str, query: &[(&str, &str)]) -> String {
    let mut address = Url::parse(&format!("{SCHEME}://pair/{path}")).expect("a pair link is a valid address");
    if !query.is_empty() {
        address.query_pairs_mut().extend_pairs(query);
    }
    address.into()
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn toast(launch: &str, title: &str, body: &str, buttons: &[(&str, String)]) -> String {
    let actions: String = buttons
        .iter()
        .map(|(label, target)| format!(r#"<action content="{}" activationType="protocol" arguments="{}"/>"#, escape(label), escape(target)))
        .collect();
    format!(
        r#"<toast launch="{}" activationType="protocol" duration="long"><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual><actions>{actions}</actions></toast>"#,
        escape(launch),
        escape(title),
        escape(body),
    )
}

pub fn request_toast(request: &Request) -> String {
    let browser = request.browser.as_deref().unwrap_or("A browser");
    let there = request.browser.as_deref().unwrap_or("this browser");
    let decide = |path: &str| link(path, &[("r", &request.id), ("n", &request.nonce)]);
    toast(
        &link("open", &[("r", &request.id)]),
        &format!("{browser} wants to connect to Browsentic Bridge"),
        &format!("Allow it to use your agent and drive this browser? If you didn’t just install or open Browsentic in {there}, don’t allow it."),
        &[("Allow", decide("allow")), ("Deny", decide("deny"))],
    )
}

pub fn paired_toast(session: &str, name: &str, nonce: &str) -> String {
    toast(
        &link("open", &[]),
        &format!("{name} connected to Browsentic Bridge"),
        &format!("It paired by itself. If you didn’t just install or open Browsentic in {name}, unpair it."),
        &[("Unpair", link("unpair", &[("s", session), ("n", nonce)]))],
    )
}

#[cfg(windows)]
mod toasts {
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    const GROUP: &str = "pair";

    pub fn post(app_id: &str, xml: &str, tag: Option<&str>) -> windows::core::Result<()> {
        let content = XmlDocument::new()?;
        content.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&content)?;
        if let Some(tag) = tag {
            toast.SetTag(&HSTRING::from(tag))?;
            toast.SetGroup(&HSTRING::from(GROUP))?;
        }
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
    }

    pub fn withdraw(app_id: &str, tag: &str) -> windows::core::Result<()> {
        ToastNotificationManager::History()?.RemoveGroupedTagWithId(&HSTRING::from(tag), &HSTRING::from(GROUP), &HSTRING::from(app_id))
    }
}

/// Toasts go to the identity the installer stamps on the Start menu shortcut; without that shortcut, as
/// in a development build, Windows drops them and the tray item and the window carry the request alone.
#[cfg(windows)]
pub fn post(app_id: &str, xml: &str, tag: Option<&str>) {
    let _ = toasts::post(app_id, xml, tag);
}

#[cfg(windows)]
pub fn withdraw(app_id: &str, tag: &str) {
    let _ = toasts::withdraw(app_id, tag);
}

#[cfg(not(windows))]
pub fn post(_: &str, _: &str, _: Option<&str>) {}

#[cfg(not(windows))]
pub fn withdraw(_: &str, _: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str, nonce: &str) -> Request {
        Request { id: id.into(), browser: Some("Brave".into()), nonce: nonce.into() }
    }

    #[test]
    fn reads_each_link_the_toasts_carry_and_nothing_else() {
        assert_eq!(parse("browsentic://pair/allow?r=Ab3_x-9q&n=NONCE"), Some(Link::Decide { request: "Ab3_x-9q".into(), nonce: "NONCE".into(), allow: true }));
        assert_eq!(parse("browsentic://pair/deny/?r=Ab3&n=N"), Some(Link::Decide { request: "Ab3".into(), nonce: "N".into(), allow: false }));
        assert_eq!(parse("browsentic://pair/unpair?s=chrome-extension%3A%2F%2Fabc%2F&n=N"), Some(Link::Unpair { session: "chrome-extension://abc/".into(), nonce: "N".into() }));
        assert_eq!(parse("browsentic://pair/open?r=Ab3"), Some(Link::Open { request: Some("Ab3".into()) }));
        assert_eq!(parse("browsentic://pair/open"), Some(Link::Open { request: None }));
        assert_eq!(parse("browsentic://pair/allow?r=Ab3"), Some(Link::Decide { request: "Ab3".into(), nonce: String::new(), allow: true }));
        assert_eq!(parse("browsentic://pair/allow?n=N"), None);
        assert_eq!(parse("browsentic://elsewhere/allow?r=Ab3&n=N"), None);
        assert_eq!(parse("https://pair/allow?r=Ab3&n=N"), None);
        assert_eq!(parse("--pairing"), None);
        assert_eq!(parse("browsentic://pair/approve-all"), None);
    }

    #[test]
    fn a_link_acts_only_with_the_nonce_held_for_it_and_otherwise_opens_the_window() {
        let pairing = Pairing::default();
        pairing.list(&[request("r1", "secret-one")]);
        let session_nonce = pairing.vouch_for("s1").unwrap();
        let judged = |address: &str| pairing.judge(parse(address).unwrap());

        assert_eq!(judged("browsentic://pair/allow?r=r1&n=secret-one"), Some(Act::Decide { request: "r1".into(), allow: true }));
        assert_eq!(judged("browsentic://pair/deny?r=r1&n=secret-one"), Some(Act::Decide { request: "r1".into(), allow: false }));
        assert_eq!(judged("browsentic://pair/allow?r=r1&n=secret-onf"), Some(Act::Show { request: Some("r1".into()) }));
        assert_eq!(judged("browsentic://pair/allow?r=r1&n=secret"), Some(Act::Show { request: Some("r1".into()) }));
        assert_eq!(judged("browsentic://pair/allow?r=r1"), Some(Act::Show { request: Some("r1".into()) }));
        assert_eq!(judged("browsentic://pair/allow?r=r2&n=secret-one"), Some(Act::Show { request: Some("r2".into()) }));
        assert_eq!(judged(&format!("browsentic://pair/unpair?s=s1&n={session_nonce}")), Some(Act::Unpair { session: "s1".into() }));
        assert_eq!(judged(&format!("browsentic://pair/unpair?s=s2&n={session_nonce}")), Some(Act::Browsers));
        assert_eq!(judged("browsentic://pair/unpair?s=s1&n=guess"), Some(Act::Browsers));
        assert!(!Act::Decide { request: "r1".into(), allow: true }.opens_window());
        assert!(Act::Browsers.opens_window());
    }

    #[test]
    fn a_decided_request_stops_answering_to_its_old_nonce() {
        let pairing = Pairing::default();
        pairing.list(&[request("r1", "secret-one")]);
        let change = pairing.list(&[]);
        assert_eq!(change.removed, ["r1"]);
        assert_eq!(pairing.judge(parse("browsentic://pair/allow?r=r1&n=secret-one").unwrap()), Some(Act::Show { request: Some("r1".into()) }));
    }

    #[test]
    fn a_link_that_started_the_app_waits_for_the_list_and_is_then_judged_by_it() {
        let pairing = Pairing::default();
        assert_eq!(pairing.judge(parse("browsentic://pair/allow?r=r1&n=secret-one").unwrap()), None);
        assert_eq!(pairing.judge(parse("browsentic://pair/deny?r=r1&n=forged").unwrap()), None);
        let change = pairing.list(&[request("r1", "secret-one"), request("r2", "secret-two")]);
        assert_eq!(change.added, [request("r1", "secret-one"), request("r2", "secret-two")]);
        assert_eq!(change.released, [Act::Decide { request: "r1".into(), allow: true }, Act::Show { request: Some("r1".into()) }]);
        assert_eq!(pairing.list(&[request("r2", "secret-two")]), Change { added: vec![], removed: vec!["r1".into()], released: vec![] });
    }

    #[test]
    fn a_request_listed_again_after_the_bridge_dropped_away_is_not_announced_twice() {
        let pairing = Pairing::default();
        assert_eq!(pairing.list(&[request("r1", "secret-one")]).added, [request("r1", "secret-one")]);
        assert_eq!(pairing.list(&[]).removed, ["r1".to_string()]);
        let again = pairing.list(&[request("r1", "secret-one"), request("r2", "secret-two")]);
        assert_eq!(again.added, [request("r2", "secret-two")]);
        assert_eq!(pairing.judge(parse("browsentic://pair/allow?r=r1&n=secret-one").unwrap()), Some(Act::Decide { request: "r1".into(), allow: true }));
    }

    #[test]
    fn a_flood_of_links_before_the_list_keeps_only_a_few() {
        let pairing = Pairing::default();
        for guess in 0..50 {
            pairing.judge(parse(&format!("browsentic://pair/allow?r=r1&n={guess}")).unwrap());
        }
        assert_eq!(pairing.list(&[request("r1", "secret-one")]).released.len(), MOST_WAITING);
    }

    #[test]
    fn each_session_gets_a_fresh_unguessable_nonce() {
        let pairing = Pairing::default();
        let (first, second) = (pairing.vouch_for("s1").unwrap(), pairing.vouch_for("s2").unwrap());
        assert_eq!(first.len(), 32);
        assert_ne!(first, second);
    }

    #[test]
    fn the_toast_carries_the_nonce_only_in_its_buttons_and_escapes_what_the_browser_sent() {
        let xml = request_toast(&Request { id: "r1".into(), browser: Some("Brave <beta> & co".into()), nonce: "a+b/c".into() });
        assert!(xml.contains("<text>Brave &lt;beta&gt; &amp; co wants to connect to Browsentic Bridge</text>"));
        assert!(xml.contains(r#"launch="browsentic://pair/open?r=r1""#));
        assert!(xml.contains(r#"<action content="Allow" activationType="protocol" arguments="browsentic://pair/allow?r=r1&amp;n=a%2Bb%2Fc"/>"#));
        assert!(xml.contains(r#"<action content="Deny" activationType="protocol" arguments="browsentic://pair/deny?r=r1&amp;n=a%2Bb%2Fc"/>"#));
        assert_eq!(parse("browsentic://pair/allow?r=r1&n=a%2Bb%2Fc"), Some(Link::Decide { request: "r1".into(), nonce: "a+b/c".into(), allow: true }));

        let nameless = request_toast(&Request { id: "r1".into(), browser: None, nonce: "n".into() });
        assert!(nameless.contains("<text>A browser wants to connect to Browsentic Bridge</text>"));
        assert!(nameless.contains("open Browsentic in this browser, don’t allow it"));

        let paired = paired_toast("chrome-extension://abc/", "Chrome", "n0nce");
        assert!(paired.contains("<text>Chrome connected to Browsentic Bridge</text>"));
        assert!(paired.contains(r#"launch="browsentic://pair/open""#));
        assert!(paired.contains(r#"arguments="browsentic://pair/unpair?s=chrome-extension%3A%2F%2Fabc%2F&amp;n=n0nce""#));
    }
}
