use futures_util::stream::{SplitSink, StreamExt};
use futures_util::SinkExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{oneshot, Mutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::paths::Paths;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lockfile {
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub daemon_version: Option<String>,
}

pub fn read_lock(paths: &Paths) -> Option<Lockfile> {
    serde_json::from_str(&std::fs::read_to_string(paths.lockfile()).ok()?).ok()
}

pub const OFFLINE: &str = "The daemon is not running. Turn it on from the Overview tab.";
pub const TIMEOUT: &str = "The daemon did not answer in time. Restart it from the Overview tab.";

type Sink = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;
type Pending = Arc<std::sync::Mutex<HashMap<String, oneshot::Sender<Value>>>>;

struct Connection {
    lock: Lockfile,
    sink: Sink,
    pending: Pending,
    open: Arc<AtomicBool>,
}

/// The daemon's `/control` socket, spoken natively: the same frames RemoteBridge sends, with the
/// bearer token from the lockfile, which a webview's own WebSocket has no way to send. Holding it
/// open is also what keeps the daemon from idling out.
#[derive(Default)]
pub struct Control {
    connection: Mutex<Option<Connection>>,
    next: AtomicU64,
}

impl Control {
    /// True when this opened a new socket, which has subscribed to nothing yet.
    pub async fn connect(&self, lock: Lockfile, on_event: impl Fn(String) + Send + 'static) -> Result<bool, String> {
        let mut slot = self.connection.lock().await;
        if slot.as_ref().is_some_and(|live| live.lock == lock && live.open.load(Ordering::SeqCst)) {
            return Ok(false);
        }
        *slot = None;

        let mut request = format!("ws://127.0.0.1:{}/control", lock.port).into_client_request().map_err(|error| error.to_string())?;
        let bearer = HeaderValue::from_str(&format!("Bearer {}", lock.token)).map_err(|error| error.to_string())?;
        request.headers_mut().insert("Authorization", bearer);
        let (stream, _) = tokio::time::timeout(Duration::from_secs(5), connect_async(request))
            .await
            .map_err(|_| OFFLINE.to_string())?
            .map_err(|_| OFFLINE.to_string())?;
        let (sink, mut source) = stream.split();

        let pending: Pending = Arc::default();
        let open = Arc::new(AtomicBool::new(true));
        let (reader_pending, reader_open) = (pending.clone(), open.clone());
        tokio::spawn(async move {
            while let Some(Ok(message)) = source.next().await {
                let Message::Text(text) = message else { continue };
                let Ok(frame) = serde_json::from_str::<Value>(text.as_str()) else { continue };
                if let Some(event) = frame.get("event").and_then(Value::as_str) {
                    on_event(event.to_string());
                }
                if let Some(id) = frame.get("id").and_then(Value::as_str) {
                    if let Some(waiting) = reader_pending.lock().unwrap().remove(id) {
                        let _ = waiting.send(frame);
                    }
                }
            }
            reader_open.store(false, Ordering::SeqCst);
            reader_pending.lock().unwrap().clear();
        });

        *slot = Some(Connection { lock, sink, pending, open });
        Ok(true)
    }

    /// Sends one frame and waits for the frame that answers it, which is returned whole.
    pub async fn request(&self, mut frame: Value, timeout: Duration) -> Result<Value, String> {
        let id = format!("app-{}", self.next.fetch_add(1, Ordering::SeqCst));
        frame.as_object_mut().ok_or("A control frame is a JSON object.")?.insert("id".into(), Value::String(id.clone()));
        let (sender, receiver) = oneshot::channel();
        {
            let mut slot = self.connection.lock().await;
            let live = slot.as_mut().filter(|live| live.open.load(Ordering::SeqCst)).ok_or(OFFLINE)?;
            live.pending.lock().unwrap().insert(id.clone(), sender);
            if live.sink.send(Message::text(frame.to_string())).await.is_err() {
                live.open.store(false, Ordering::SeqCst);
                return Err(OFFLINE.into());
            }
        }
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(_)) => Err(OFFLINE.into()),
            Err(_) => {
                if let Some(live) = self.connection.lock().await.as_ref() {
                    live.pending.lock().unwrap().remove(&id);
                }
                Err(TIMEOUT.into())
            }
        }
    }

    pub async fn close(&self) {
        if let Some(mut live) = self.connection.lock().await.take() {
            let _ = live.sink.close().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    /// A daemon stand-in that insists on the bearer token, answers `status`, and announces an event.
    async fn daemon(token: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let checked = |request: &Request, response: Response| {
                    let authorized = request.headers().get("Authorization").and_then(|value| value.to_str().ok()) == Some(&format!("Bearer {token}"));
                    if authorized { Ok(response) } else { Err(Response::builder().status(401).body(None).unwrap()) }
                };
                let Ok(socket) = tokio_tungstenite::accept_hdr_async(stream, checked).await else { continue };
                let (mut sink, mut source) = socket.split();
                tokio::spawn(async move {
                    while let Some(Ok(Message::Text(text))) = source.next().await {
                        let frame: Value = serde_json::from_str(text.as_str()).unwrap();
                        let reply = serde_json::json!({ "id": frame["id"], "op": "status", "status": { "port": port } });
                        sink.send(Message::text(serde_json::json!({ "event": "settings-changed" }).to_string())).await.unwrap();
                        sink.send(Message::text(reply.to_string())).await.unwrap();
                    }
                });
            }
        });
        port
    }

    fn lock(port: u16, token: &str) -> Lockfile {
        Lockfile { pid: 1, port, token: token.into(), daemon_version: None }
    }

    #[tokio::test]
    async fn asks_with_the_token_and_matches_the_answer_to_the_question() {
        let port = daemon("secret").await;
        let control = Control::default();
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let heard = events.clone();

        assert!(control.connect(lock(port, "secret"), move |event| heard.lock().unwrap().push(event)).await.unwrap());
        assert!(!control.connect(lock(port, "secret"), |_| {}).await.unwrap());
        let reply = control.request(serde_json::json!({ "op": "status" }), Duration::from_secs(2)).await.unwrap();

        assert_eq!(reply["status"]["port"], port);
        assert_eq!(events.lock().unwrap().as_slice(), ["settings-changed"]);
    }

    #[tokio::test]
    async fn a_wrong_token_is_offline_and_a_request_without_a_socket_says_so() {
        let port = daemon("secret").await;
        let control = Control::default();
        assert_eq!(control.connect(lock(port, "guess"), |_| {}).await, Err(OFFLINE.into()));
        assert_eq!(control.request(serde_json::json!({ "op": "status" }), Duration::from_secs(1)).await, Err(OFFLINE.into()));
    }
}
