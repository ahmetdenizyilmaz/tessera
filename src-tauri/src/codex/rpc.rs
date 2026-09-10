//! One owned app-server, with correlated requests and a bounded replay log.
use super::executable::Executable;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

pub type Reply = Result<Value, String>;
pub struct Client {
    pub id: String,
    pub generation: String,
    pub alive: AtomicBool,
    pub busy: AtomicBool,
    pub thread: Mutex<Option<String>>,
    pub turn: Mutex<Option<String>>,
    pub requests: Mutex<HashMap<String, Value>>,
    pub events: Mutex<VecDeque<Value>>,
    pub outcomes: broadcast::Sender<Value>,
    pub endpoint: Option<String>,
    pub token: String,
    pub executable: Executable,
    app: Option<AppHandle>,
    tx: mpsc::UnboundedSender<Value>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next: AtomicU64,
    sequence: AtomicU64,
    child: Mutex<Option<Child>>,
    token_path: Option<std::path::PathBuf>,
}

impl Client {
    pub async fn spawn(
        id: &str,
        executable: Executable,
        terminal: bool,
        env: HashMap<String, String>,
        app: Option<AppHandle>,
    ) -> Result<Arc<Self>, String> {
        let mut cmd = executable.command();
        cmd.arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        cmd.envs(env);
        let token = uuid::Uuid::new_v4().to_string() + &uuid::Uuid::new_v4().to_string();
        let mut token_path = None;
        let endpoint = if terminal {
            let socket =
                std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
            let port = socket.local_addr().map_err(|e| e.to_string())?.port();
            drop(socket);
            let dir = crate::app_paths::data_dir().join("codex-runtime");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{}.token", uuid::Uuid::new_v4()));
            std::fs::write(&path, &token).map_err(|e| e.to_string())?;
            let url = format!("ws://127.0.0.1:{port}");
            cmd.args([
                "--listen",
                &url,
                "--ws-auth",
                "capability-token",
                "--ws-token-file",
            ])
            .arg(&path);
            token_path = Some(path);
            Some(url)
        } else {
            None
        };
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                if let Some(p) = &token_path {
                    let _ = std::fs::remove_file(p);
                }
                return Err(format!("Cannot start Codex: {e}"));
            }
        };
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let (outcomes, _) = broadcast::channel(32);
        let client = Arc::new(Self {
            id: id.into(),
            generation: uuid::Uuid::new_v4().to_string(),
            alive: AtomicBool::new(true),
            busy: AtomicBool::new(false),
            thread: Mutex::new(None),
            turn: Mutex::new(None),
            requests: Mutex::new(HashMap::new()),
            events: Mutex::new(VecDeque::new()),
            outcomes,
            endpoint: endpoint.clone(),
            token,
            executable,
            app,
            tx,
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            sequence: AtomicU64::new(1),
            child: Mutex::new(Some(child)),
            token_path,
        });
        if let Some(url) = endpoint {
            drop(stdin);
            drop(stdout);
            let mut connected = None;
            for _ in 0..100 {
                let mut request = url
                    .clone()
                    .into_client_request()
                    .map_err(|e| e.to_string())?;
                request.headers_mut().insert(
                    "Authorization",
                    format!("Bearer {}", client.token).parse().unwrap(),
                );
                if let Ok(Ok((ws, _))) = tokio::time::timeout(
                    Duration::from_millis(300),
                    tokio_tungstenite::connect_async(request),
                )
                .await
                {
                    connected = Some(ws);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            let Some(ws) = connected else {
                client.stop();
                return Err("Codex terminal backend did not become ready. Check that Codex supports authenticated app-server WebSockets.".into());
            };
            let (mut writer, mut reader) = ws.split();
            let weak = Arc::downgrade(&client);
            tokio::spawn(async move {
                while let Some(value) = rx.recv().await {
                    if value.is_null() {
                        break;
                    }
                    if writer.send(Message::Text(value.to_string())).await.is_err() {
                        break;
                    }
                }
                let _ = writer.close().await;
            });
            tokio::spawn(async move {
                while let Some(Ok(message)) = reader.next().await {
                    let Some(c) = weak.upgrade() else {
                        break;
                    };
                    if let Message::Text(text) = message {
                        match serde_json::from_str(&text) {
                            Ok(v) => c.receive(v),
                            Err(_) => {
                                c.fail("Codex sent malformed JSON");
                                break;
                            }
                        }
                    }
                }
                if let Some(c) = weak.upgrade() {
                    c.fail("Codex connection closed");
                }
            });
        } else {
            let weak = Arc::downgrade(&client);
            std::thread::spawn(move || {
                let mut stdin = stdin;
                while let Some(value) = rx.blocking_recv() {
                    if value.is_null() {
                        break;
                    }
                    if writeln!(stdin, "{value}")
                        .and_then(|_| stdin.flush())
                        .is_err()
                    {
                        break;
                    }
                }
            });
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Some(c) = weak.upgrade() else {
                        break;
                    };
                    match line {
                        Ok(s) if s.trim().is_empty() => continue,
                        Ok(s) => match serde_json::from_str(&s) {
                            Ok(v) => c.receive(v),
                            Err(_) => {
                                c.fail("Codex sent malformed JSON");
                                break;
                            }
                        },
                        Err(_) => break,
                    }
                }
                if let Some(c) = weak.upgrade() {
                    c.fail("Codex process exited");
                }
            });
        }
        if let Err(e) = client.call("initialize", json!({
            "clientInfo": {"name":"tessera","title":"Tessera","version":env!("CARGO_PKG_VERSION")},
            "capabilities": {"experimentalApi":false,"requestAttestation":false}
        })).await {
            client.stop(); return Err(format!("Codex initialization failed: {e}"));
        }
        client.notify(json!({"method":"initialized","params":{}}))?;
        Ok(client)
    }

    pub fn notify(&self, value: Value) -> Result<(), String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("Codex is disconnected. Resume this panel to reconnect.".into());
        }
        self.tx
            .send(value)
            .map_err(|_| "Codex writer closed".into())
    }

    pub async fn call(&self, method: &str, params: Value) -> Reply {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Err(e) = self.notify(json!({"id":id,"method":method,"params":params})) {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }
        match tokio::time::timeout(Duration::from_secs(60), rx).await {
            Ok(Ok(result)) => result,
            _ => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("Codex {method} timed out or disconnected. The request may have been accepted; it was not replayed."))
            }
        }
    }

    fn receive(&self, value: Value) {
        if !self.alive.load(Ordering::Acquire) {
            return;
        }
        if value.get("method").is_none() {
            if let Some(id) = value["id"].as_u64() {
                if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
                    let result = if value.get("error").is_some() {
                        Err(value["error"]["message"]
                            .as_str()
                            .unwrap_or("Codex request failed")
                            .to_string())
                    } else {
                        Ok(value["result"].clone())
                    };
                    let _ = tx.send(result);
                }
            }
            return;
        }
        let method = value["method"].as_str().unwrap_or("");
        let params = &value["params"];
        // Subagent events belong to their own threads, never to this panel's transcript.
        if let Some(thread) = params["threadId"].as_str() {
            if self
                .thread
                .lock()
                .unwrap()
                .as_deref()
                .is_some_and(|own| own != thread)
            {
                if value.get("id").is_some() {
                    let _ = self.notify(json!({"id":value["id"],"error":{"code":-32600,"message":"Approval belongs to another thread; Tessera did not grant it"}}));
                }
                return;
            }
        }
        if value.get("id").is_some() {
            if !super::supported_request(method) {
                let _ = self.notify(json!({"id":value["id"],"error":{"code":-32601,"message":"This request is not supported by Tessera"}}));
                self.publish(json!({"method":"tessera/error","params":{"message":format!("Unsupported Codex request: {method}")}}));
                return;
            }
            self.requests
                .lock()
                .unwrap()
                .insert(value["id"].to_string(), value.clone());
            let _ = self.outcomes.send(json!({"status":"awaiting_user_input"}));
        }
        match method {
            "turn/started" => {
                self.busy.store(true, Ordering::Release);
                *self.turn.lock().unwrap() = params["turn"]["id"].as_str().map(String::from);
            }
            "turn/completed" => {
                self.busy.store(false, Ordering::Release);
                *self.turn.lock().unwrap() = None;
                self.requests.lock().unwrap().clear();
                let _ = self
                    .outcomes
                    .send(json!({"status":params["turn"]["status"],"turn":params["turn"]}));
            }
            "serverRequest/resolved" => {
                self.requests
                    .lock()
                    .unwrap()
                    .remove(&params["requestId"].to_string());
            }
            _ => {}
        }
        self.publish(value);
    }

    pub fn publish(&self, message: Value) {
        let event = json!({"id":self.id,"generation":self.generation,"sequence":self.sequence.fetch_add(1,Ordering::Relaxed),"message":message});
        {
            let mut events = self.events.lock().unwrap();
            events.push_back(event.clone());
            // Completed transcripts are recoverable through thread/read.
            while events.len() > 4096 {
                events.pop_front();
            }
        }
        if let Some(app) = &self.app {
            let _ = app.emit("codex-event", event);
        }
    }

    pub fn fail(&self, reason: &str) {
        if !self.alive.swap(false, Ordering::AcqRel) {
            return;
        }
        self.busy.store(false, Ordering::Release);
        self.requests.lock().unwrap().clear();
        for (_, tx) in self.pending.lock().unwrap().drain() {
            let _ = tx.send(Err(reason.into()));
        }
        let _ = self.outcomes.send(json!({"status":"process_ended"}));
        self.publish(json!({"method":"tessera/disconnected","params":{"message":reason}}));
        let _ = self.tx.send(Value::Null);
    }

    pub fn stop(&self) {
        self.fail("Codex panel closed");
        if let Some(mut child) = self.child.lock().unwrap().take() {
            if child.try_wait().ok().flatten().is_none() {
                crate::util::proc::kill_tree(child.id());
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        if let Some(path) = &self.token_path {
            let _ = std::fs::remove_file(path);
        }
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mock() -> (Client, mpsc::UnboundedReceiver<Value>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let (outcomes, _) = broadcast::channel(4);
        (
            Client {
                id: "panel".into(),
                generation: "generation".into(),
                alive: AtomicBool::new(true),
                busy: AtomicBool::new(false),
                thread: Mutex::new(Some("thread-a".into())),
                turn: Mutex::new(None),
                requests: Mutex::new(HashMap::new()),
                events: Mutex::new(VecDeque::new()),
                outcomes,
                endpoint: None,
                token: String::new(),
                executable: Executable {
                    program: "unused".into(),
                    args: vec![],
                },
                app: None,
                tx,
                pending: Mutex::new(HashMap::new()),
                next: AtomicU64::new(1),
                sequence: AtomicU64::new(1),
                child: Mutex::new(None),
                token_path: None,
            },
            rx,
        )
    }
    #[test]
    fn other_threads_cannot_change_activity_or_request_approval() {
        let (c, _) = mock();
        c.receive(
            json!({"method":"turn/started","params":{"threadId":"thread-b","turn":{"id":"other"}}}),
        );
        assert!(!c.busy.load(Ordering::Acquire));
        c.receive(json!({"id":2,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread-b"}}));
        assert!(c.requests.lock().unwrap().is_empty());
    }
    #[test]
    fn completion_clears_pending_requests_and_resolves_watchers() {
        let (c, _) = mock();
        let mut receiver = c.outcomes.subscribe();
        c.receive(json!({"method":"turn/started","params":{"threadId":"thread-a","turn":{"id":"turn-a"}}}));
        c.receive(json!({"id":4,"method":"item/fileChange/requestApproval","params":{"threadId":"thread-a"}}));
        assert_eq!(
            receiver.try_recv().unwrap()["status"],
            "awaiting_user_input"
        );
        c.receive(json!({"method":"turn/completed","params":{"threadId":"thread-a","turn":{"id":"turn-a","status":"completed"}}}));
        assert!(!c.busy.load(Ordering::Acquire));
        assert!(c.requests.lock().unwrap().is_empty());
        assert_eq!(receiver.try_recv().unwrap()["status"], "completed");
    }
    #[tokio::test]
    async fn response_ids_are_correlated_and_not_mixed_with_server_requests() {
        let (c, mut wire) = mock();
        let request = c.call("model/list", json!({}));
        let server = async {
            let v = wire.recv().await.unwrap();
            c.receive(json!({"id":999,"result":{"wrong":true}}));
            c.receive(json!({"id":v["id"],"result":{"models":["test"]}}));
        };
        let (result, _) = tokio::join!(request, server);
        assert_eq!(result.unwrap()["models"], json!(["test"]));
    }
    #[test]
    fn unsupported_requests_fail_closed() {
        let (c, mut wire) = mock();
        c.receive(json!({"id":9,"method":"unknown/request","params":{}}));
        assert_eq!(wire.try_recv().unwrap()["error"]["code"], -32601);
        assert!(c.requests.lock().unwrap().is_empty());
    }
    #[tokio::test]
    #[ignore = "Uses the installed Codex CLI and account for two tiny model turns"]
    async fn live_transports_and_exact_thread_resume() {
        for terminal in [false, true] {
            let c = Client::spawn(
                "smoke",
                super::super::executable::resolve(None).unwrap(),
                terminal,
                HashMap::new(),
                None,
            )
            .await
            .unwrap();
            let models = c.call("model/list", json!({"limit":20})).await.unwrap();
            assert!(!models["data"].as_array().unwrap().is_empty());
            let cwd = std::env::temp_dir();
            let first=c.call("thread/start",json!({"cwd":cwd,"approvalPolicy":"on-request","approvalsReviewer":"user","sandbox":"read-only"})).await.unwrap();
            let sid = first["thread"]["id"].as_str().unwrap();
            *c.thread.lock().unwrap() = Some(sid.into());
            // Codex deliberately materializes new threads only on their first
            // user turn. Attaching a TUI before this fails with no rollout found.
            let mut turns = c.outcomes.subscribe();
            let model = models["data"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["model"] == "gpt-5.6-luna")
                .unwrap_or(&models["data"][0])["model"]
                .clone();
            c.call("turn/start",json!({"threadId":sid,"model":model,"input":[{"type":"text","text":"Reply with exactly TESSERA_SMOKE_OK. Do not use tools.","text_elements":[]}]})).await.unwrap();
            let outcome = tokio::time::timeout(Duration::from_secs(90), turns.recv())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(outcome["status"], "completed", "{outcome}");
            let resumed=c.call("thread/resume",json!({"threadId":sid,"sandbox":"read-only","approvalPolicy":"on-request","approvalsReviewer":"user"})).await.unwrap();
            assert_eq!(resumed["thread"]["id"], sid);
            c.stop();
            assert!(!c.alive.load(Ordering::Acquire));
        }
    }
}
