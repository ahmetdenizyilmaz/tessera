pub mod config;
mod executable;
pub use config::Config;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};

struct Server {
    child: Mutex<Child>,
    stopped: AtomicBool,
    url: String,
    password: String,
    env: HashMap<String, String>,
    executable: executable::Executable,
    config: Config,
    session_id: Mutex<String>,
    client: reqwest::Client,
    generation: String,
    gate: tokio::sync::Mutex<()>,
    events: Mutex<Option<tokio::task::AbortHandle>>,
    revision: AtomicU64,
    ui_read_at: Mutex<std::time::Instant>,
}
impl Server {
    fn stop(&self) {
        if self.stopped.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(task) = self.events.lock().unwrap().take() {
            task.abort();
        }
        let mut c = self.child.lock().unwrap();
        // Reap first: never kill a PID that has exited and may have been reused.
        if matches!(c.try_wait(), Ok(None)) {
            crate::util::proc::kill_tree(c.id());
            let _ = c.kill();
        }
        let _ = c.wait();
    }
    fn sid(&self) -> String {
        self.session_id.lock().unwrap().clone()
    }
    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        if self.stopped.load(Ordering::SeqCst) {
            return Err("OpenCode is disconnected. Retry / resume this panel.".into());
        }
        let mut r = self
            .client
            .request(method, format!("{}{path}", self.url))
            .basic_auth("opencode", Some(&self.password))
            .query(&[("directory", &self.config.cwd)]);
        if let Some(b) = body {
            r = r.json(&b);
        }
        let response = r.send().await.map_err(|_| {
            "Cannot reach this panel's OpenCode server. Retry / resume the panel.".to_string()
        })?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|_| "Cannot read the OpenCode response.".to_string())?;
        if !status.is_success() {
            // Do not echo provider headers, configuration, or response bodies containing credentials.
            return Err(format!("OpenCode {path} returned HTTP {}. Check the model, endpoint, API key, and CLI version.",status.as_u16()));
        }
        if bytes.is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_slice(&bytes)
                .map_err(|_| "Unexpected OpenCode response. Update the CLI and retry.".into())
        }
    }
    async fn get(&self, path: &str) -> Result<Value, String> {
        self.request(reqwest::Method::GET, path, None).await
    }
    async fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        self.request(reqwest::Method::POST, path, Some(body)).await
    }
    async fn owns_request(&self, session_id: &str) -> bool {
        let root = self.sid();
        let mut current = session_id.to_string();
        for _ in 0..32 {
            if current == root {
                return true;
            }
            if validate_id(&current, "ses").is_err() {
                return false;
            }
            let Ok(session) = self.get(&format!("/session/{current}")).await else {
                return false;
            };
            let Some(parent) = session["parentID"].as_str() else {
                return false;
            };
            current = parent.to_string();
        }
        false
    }
    async fn snapshot(&self) -> Result<Value, String> {
        let revision = format!(
            "{}:{}",
            self.generation,
            self.revision.load(Ordering::Acquire)
        );
        let sid = self.sid();
        let path = format!("/session/{sid}/message");
        let (messages, status, permissions, questions) = tokio::try_join!(
            self.get(&path),
            self.get("/session/status"),
            self.get("/permission"),
            self.get("/question")
        )?;
        let mut own_permissions = vec![];
        let mut own_questions = vec![];
        for (items, out) in [
            (permissions, &mut own_permissions),
            (questions, &mut own_questions),
        ] {
            for request in items.as_array().into_iter().flatten() {
                if self
                    .owns_request(request["sessionID"].as_str().unwrap_or(""))
                    .await
                {
                    out.push(request.clone());
                }
            }
        }
        let last_user = messages
            .as_array()
            .and_then(|a| a.iter().rev().find(|m| m["info"]["role"] == "user"))
            .map(|m| &m["info"]);
        let selected_model = last_user
            .filter(|m| m["model"]["providerID"] == self.config.provider_id())
            .and_then(|m| m["model"]["modelID"].as_str())
            .unwrap_or(&self.config.model);
        let agent = last_user
            .and_then(|m| m["agent"].as_str())
            .filter(|a| ["build", "plan"].contains(a))
            .unwrap_or(&self.config.agent);
        *self.ui_read_at.lock().unwrap() = std::time::Instant::now();
        Ok(
            json!({"sessionId":sid,"generation":self.generation,"revision":revision,"model":selected_model,"agent":agent,"messages":messages,"status":status.get(&sid).cloned().unwrap_or(json!({"type":"idle"})),"permissions":own_permissions,"questions":own_questions,"connected":true}),
        )
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Native TUI /new and subsequent messages must update the saved session ID.
/// This reader stays in Rust even when the panel is hidden in a group. Child
/// agent sessions never replace the panel's root conversation.
fn watch_native_sessions(server: &Arc<Server>) {
    let weak = Arc::downgrade(server);
    let task = tauri::async_runtime::spawn(async move {
        loop {
            let Some(s) = weak.upgrade() else { return };
            if s.stopped.load(Ordering::SeqCst) {
                return;
            }
            let request = s
                .client
                .get(format!("{}/event", s.url))
                .basic_auth("opencode", Some(&s.password))
                .query(&[("directory", &s.config.cwd)])
                .timeout(Duration::from_secs(60 * 60));
            drop(s);
            if let Ok(response) = request.send().await {
                let mut stream = response.bytes_stream();
                let mut buffer = String::new();
                while let Some(Ok(bytes)) = stream.next().await {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(end) = buffer.find('\n') {
                        let line = buffer[..end].trim_end_matches('\r').to_string();
                        buffer.drain(..=end);
                        let Some(data) = line.strip_prefix("data: ") else {
                            continue;
                        };
                        let Ok(event) = serde_json::from_str::<Value>(data) else {
                            continue;
                        };
                        if event["type"] != "server.heartbeat" {
                            let Some(s) = weak.upgrade() else {
                                return;
                            };
                            s.revision.fetch_add(1, Ordering::AcqRel);
                        }
                        let info = &event["properties"]["info"];
                        let sid = match event["type"].as_str() {
                            Some("session.created") if info["parentID"].is_null() => {
                                info["id"].as_str()
                            }
                            Some("message.updated") if info["role"] == "user" => {
                                info["sessionID"].as_str()
                            }
                            _ => None,
                        };
                        if let Some(sid) = sid {
                            if validate_id(sid, "ses").is_err() {
                                continue;
                            }
                            let Some(s) = weak.upgrade() else { return };
                            if let Ok(session) = s.get(&format!("/session/{sid}")).await {
                                if session["parentID"].is_null() {
                                    *s.session_id.lock().unwrap() = sid.to_string();
                                    s.revision.fetch_add(1, Ordering::AcqRel);
                                }
                            }
                        }
                    }
                    if buffer.len() > 4 * 1024 * 1024 {
                        buffer.clear();
                    }
                }
            }
            if let Some(s) = weak.upgrade() {
                s.revision.fetch_add(1, Ordering::AcqRel);
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
    *server.events.lock().unwrap() = Some(task.inner().abort_handle());
}

#[derive(Default)]
pub struct OpenCodeManager {
    sessions: Mutex<HashMap<String, Arc<Server>>>,
    gate: tokio::sync::Mutex<()>,
}
impl OpenCodeManager {
    fn get(&self, id: &str) -> Result<Arc<Server>, String> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| "Open or resume this OpenCode panel first.".into())
    }
    pub fn kill_all(&self) {
        for (_, s) in self.sessions.lock().unwrap().drain() {
            s.stop();
        }
    }
}

#[tauri::command]
pub async fn opencode_discover(executable_path: String) -> Result<Value, String> {
    let exe = executable::resolve(&executable_path)?;
    let display = exe.program.to_string_lossy().to_string();
    let mut command = tokio::process::Command::from(exe.command());
    command.arg("--version").kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(15), command.output())
        .await
        .map_err(|_| "OpenCode version check timed out.".to_string())?
        .map_err(|e| format!("Cannot start OpenCode: {e}"))?;
    if !output.status.success() {
        return Err("OpenCode version check failed. Choose a working CLI executable.".into());
    }
    Ok(json!({"path":display,"version":String::from_utf8_lossy(&output.stdout).trim()}))
}

async fn api_key(config: &Config) -> Result<String, String> {
    let key = crate::llm::keystore::llm_get_api_key(config.key_slot()?)
        .await?
        .unwrap_or_default();
    if key.trim().is_empty() && !config.compatible() {
        return Err(format!("Add your {} API key in OpenCode settings first. This uses API billing, not a Claude or ChatGPT subscription.",config.provider));
    }
    Ok(key)
}

#[tauri::command]
pub async fn opencode_models(config: Config) -> Result<Vec<String>, String> {
    let endpoint = config.endpoint()?;
    let key = api_key(&config).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(format!("{endpoint}/models"));
    if !key.is_empty() {
        req = match config.provider.as_str() {
            "anthropic" => req
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01"),
            "gemini" => req.header("x-goog-api-key", key),
            _ => req.bearer_auth(key),
        };
    }
    let res = req.send().await.map_err(|_| {
        "Model discovery failed. Check the endpoint and that the local server is running."
            .to_string()
    })?;
    if !res.status().is_success() {
        return Err(format!(
            "Model discovery returned HTTP {}. Check the API key and endpoint.",
            res.status().as_u16()
        ));
    }
    let body: Value = res
        .json()
        .await
        .map_err(|_| "The endpoint did not return a model list.".to_string())?;
    let array = body["data"]
        .as_array()
        .or_else(|| body["models"].as_array())
        .ok_or("No models returned. You can enter the exact model ID manually.")?;
    let mut models: Vec<String> = array
        .iter()
        .filter_map(|m| m["id"].as_str().or_else(|| m["name"].as_str()))
        .map(|s| s.trim_start_matches("models/").to_string())
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

#[tauri::command]
pub async fn opencode_configure(
    id: String,
    config: Config,
    session_id: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, OpenCodeManager>,
) -> Result<Value, String> {
    let _guard = state.gate.lock().await;
    config.validate()?;
    if let Ok(existing) = state.get(&id) {
        if existing.config != config {
            return Err("Reconnect the OpenCode panel to apply changed settings.".into());
        }
        return existing.snapshot().await;
    }
    if state
        .sessions
        .lock()
        .unwrap()
        .values()
        .any(|s| s.config.data_id == config.data_id)
    {
        return Err("This OpenCode conversation is already open in another panel.".into());
    }
    if let Some(sid) = &session_id {
        validate_id(sid, "ses")?;
    }
    let key = api_key(&config).await?;
    let root = crate::app_paths::data_dir()
        .join("opencode")
        .join(&config.data_id);
    let mut runtime = config.runtime_config()?;
    if let Some(bus) = app.try_state::<crate::panelbus::PanelBus>() {
        if let (true, Some(bus_port)) = (bus.is_enabled(), bus.port) {
            runtime["mcp"] = json!({"tessera-panels":{"type":"remote","url":format!("http://127.0.0.1:{bus_port}/mcp/{id}"),"headers":{"Authorization":"Bearer {env:TESSERA_PANEL_TOKEN}"},"oauth":false}});
        }
    }
    let token = app
        .try_state::<crate::panelbus::PanelBus>()
        .map(|bus| bus.token_for(&id));
    let server = launch_server(config, &root, &key, runtime, token).await?;
    let session = if let Some(sid) = session_id {
        server.get(&format!("/session/{sid}")).await.map_err(|_|"The saved OpenCode session was not found in this PC's Tessera data. Its history may only exist on the original PC; start a new panel to use this provider here.".to_string())?
    } else {
        server.post("/session",json!({"title":"Tessera", "agent":server.config.agent,"model":{"providerID":server.config.provider_id(),"id":server.config.model}})).await?
    };
    let sid = session["id"]
        .as_str()
        .ok_or("OpenCode did not return a session ID.")?
        .to_string();
    *server.session_id.lock().unwrap() = sid;
    let snapshot = server.snapshot().await?;
    watch_native_sessions(&server);
    state.sessions.lock().unwrap().insert(id, server);
    Ok(snapshot)
}

async fn launch_server(
    config: Config,
    root: &std::path::Path,
    key: &str,
    mut runtime: Value,
    token: Option<String>,
) -> Result<Arc<Server>, String> {
    let executable = executable::resolve(&config.executable_path)?;
    std::fs::create_dir_all(root).map_err(|e| format!("Cannot create OpenCode storage: {e}"))?;
    if !config.instructions.trim().is_empty() {
        // `agent.prompt` replaces OpenCode's built-in coding prompt. Use its
        // additive instruction-file mechanism instead (also works in the TUI).
        let path = root.join("tessera-instructions.md");
        std::fs::write(&path, &config.instructions)
            .map_err(|e| format!("Cannot save this panel's OpenCode instructions: {e}"))?;
        let instructions = runtime
            .as_object_mut()
            .unwrap()
            .entry("instructions")
            .or_insert_with(|| json!([]));
        if let Some(items) = instructions.as_array_mut() {
            items.push(json!(path.to_string_lossy()));
        }
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let password = uuid::Uuid::new_v4().to_string();
    let mut env = config::environment(&config, root, &password, key, runtime);
    if let Some(token) = token {
        env.insert("TESSERA_PANEL_TOKEN".into(), token);
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut command = executable.command();
    command
        .env_clear()
        .envs(&env)
        .current_dir(&config.cwd)
        .args([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    drop(listener);
    let child = command
        .spawn()
        .map_err(|e| format!("Cannot start OpenCode: {e}"))?;
    let server = Arc::new(Server {
        child: Mutex::new(child),
        stopped: AtomicBool::new(false),
        url: format!("http://127.0.0.1:{port}"),
        password,
        env,
        executable,
        config,
        session_id: Mutex::new(String::new()),
        client,
        generation: uuid::Uuid::new_v4().to_string(),
        gate: tokio::sync::Mutex::new(()),
        events: Mutex::new(None),
        revision: AtomicU64::new(1),
        ui_read_at: Mutex::new(std::time::Instant::now()),
    });
    let ready=tokio::time::timeout(Duration::from_secs(45),async{
        loop {
            if server.child.lock().unwrap().try_wait().map_err(|e|e.to_string())?.is_some(){return Err("OpenCode exited during startup. Check the executable and project configuration.".to_string());}
            if let Ok(health)=server.get("/global/health").await{if health["healthy"]==true{return Ok(());}}
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }).await.map_err(|_|"OpenCode startup timed out. Check the CLI and try again.".to_string());
    ready??;
    Ok(server)
}

fn validate_id(value: &str, prefix: &str) -> Result<(), String> {
    if value.starts_with(prefix)
        && value.len() < 128
        && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        Ok(())
    } else {
        Err("Invalid OpenCode request ID.".into())
    }
}

#[tauri::command]
pub async fn opencode_snapshot(
    id: String,
    known_revision: Option<String>,
    state: tauri::State<'_, OpenCodeManager>,
) -> Result<Option<Value>, String> {
    let server = state.get(&id)?;
    if server
        .child
        .lock()
        .unwrap()
        .try_wait()
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("OpenCode exited. Retry / resume this panel.".into());
    }
    let revision = format!(
        "{}:{}",
        server.generation,
        server.revision.load(Ordering::Acquire)
    );
    // Avoid full transcript transfers while an idle panel is unchanged. SSE
    // invalidates the token; a periodic refresh also repairs missed events.
    if known_revision.as_deref() == Some(&revision)
        && server.ui_read_at.lock().unwrap().elapsed() < Duration::from_secs(30)
    {
        return Ok(None);
    }
    server.snapshot().await.map(Some)
}

pub async fn send(app: &AppHandle, id: &str, text: String, no_reply: bool) -> Result<(), String> {
    let server = app.state::<OpenCodeManager>().get(id)?;
    let _guard = server.gate.lock().await;
    let snapshot = server.snapshot().await?;
    if snapshot["status"]["type"] != "idle"
        || snapshot["permissions"]
            .as_array()
            .is_some_and(|v| !v.is_empty())
        || snapshot["questions"]
            .as_array()
            .is_some_and(|v| !v.is_empty())
    {
        return Err(
            "OpenCode is busy or waiting for your approval. Finish or stop the current turn first."
                .into(),
        );
    }
    let mut body = json!({"parts":[{"type":"text","text":text}],"agent":snapshot["agent"],"model":{"providerID":server.config.provider_id(),"modelID":snapshot["model"]}});
    if no_reply {
        body["noReply"] = json!(true);
    }
    server
        .post(
            &format!(
                "/session/{}/{}",
                server.sid(),
                if no_reply { "message" } else { "prompt_async" }
            ),
            body,
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn opencode_send(id: String, text: String, app: AppHandle) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Enter a message.".into());
    }
    send(&app, &id, text, false).await
}

/// Seed a cross-agent fork as context, with no model call or billable turn.
#[tauri::command]
pub async fn opencode_seed(id: String, text: String, app: AppHandle) -> Result<(), String> {
    send(&app, &id, text, true).await
}

#[tauri::command]
pub async fn opencode_interrupt(
    id: String,
    state: tauri::State<'_, OpenCodeManager>,
) -> Result<(), String> {
    let s = state.get(&id)?;
    s.post(&format!("/session/{}/abort", s.sid()), json!({}))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn opencode_respond(
    id: String,
    request_id: String,
    kind: String,
    reply: Option<String>,
    answers: Option<Vec<Vec<String>>>,
    state: tauri::State<'_, OpenCodeManager>,
) -> Result<(), String> {
    let s = state.get(&id)?;
    let (path, body) = match kind.as_str() {
        "permission" => {
            validate_id(&request_id, "per")?;
            let r = reply.unwrap_or_default();
            if !["once", "always", "reject"].contains(&r.as_str()) {
                return Err("Invalid permission reply.".into());
            }
            (
                format!("/permission/{request_id}/reply"),
                json!({"reply":r}),
            )
        }
        "question" => {
            validate_id(&request_id, "que")?;
            if reply.as_deref() == Some("reject") {
                (format!("/question/{request_id}/reject"), json!({}))
            } else {
                (
                    format!("/question/{request_id}/reply"),
                    json!({"answers":answers.ok_or("Answers are required.")?}),
                )
            }
        }
        _ => return Err("Unknown OpenCode request.".into()),
    };
    // Do not let stale UI answer another session's request.
    let list = s
        .get(if kind == "permission" {
            "/permission"
        } else {
            "/question"
        })
        .await?;
    let request = list
        .as_array()
        .and_then(|v| v.iter().find(|r| r["id"] == request_id))
        .ok_or("This request is no longer pending in this panel.")?;
    if !s
        .owns_request(request["sessionID"].as_str().unwrap_or(""))
        .await
    {
        return Err("This request belongs to a different conversation.".into());
    }
    s.post(&path, body).await?;
    Ok(())
}

#[tauri::command]
pub async fn opencode_close(
    id: String,
    state: tauri::State<'_, OpenCodeManager>,
) -> Result<(), String> {
    let _guard = state.gate.lock().await;
    let server = state.sessions.lock().unwrap().remove(&id);
    if let Some(s) = server {
        s.stop();
    }
    Ok(())
}

#[tauri::command]
pub async fn opencode_terminal_spawn(
    id: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: tauri::State<'_, OpenCodeManager>,
    pty: tauri::State<'_, crate::pty::manager::PtyManager>,
) -> Result<(), String> {
    let s = state.get(&id)?;
    let mut cmd = portable_pty::CommandBuilder::new(&s.executable.program);
    cmd.args(&s.executable.args);
    cmd.args([
        "attach",
        &s.url,
        "--dir",
        &s.config.cwd,
        "--session",
        &s.sid(),
    ]);
    cmd.cwd(&s.config.cwd);
    cmd.env_clear();
    for (k, v) in &s.env {
        cmd.env(k, v);
    }
    crate::pty::manager::spawn_prepared(id, cmd, cols, rows, &app, &pty)
}

pub async fn read_recent(app: &AppHandle, id: &str, limit: usize) -> Result<Vec<Value>, String> {
    let s = app.state::<OpenCodeManager>().get(id)?;
    let messages = s.get(&format!("/session/{}/message", s.sid())).await?;
    let rows = messages.as_array().ok_or("Invalid OpenCode transcript.")?;
    let start = rows.len().saturating_sub(limit);
    Ok(rows[start..]
        .iter()
        .filter_map(|row| {
            let role = row["info"]["role"].as_str()?;
            let text = row["parts"]
                .as_array()?
                .iter()
                .filter(|p| p["type"] == "text")
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n");
            if text.is_empty() {
                None
            } else {
                Some(json!({"role":role,"content":text}))
            }
        })
        .collect())
}

pub async fn deliver(
    app: &AppHandle,
    id: &str,
    text: &str,
    wait: bool,
    timeout: u64,
) -> Result<Value, String> {
    let server = app.state::<OpenCodeManager>().get(id)?;
    let before = server
        .get(&format!("/session/{}/message", server.sid()))
        .await?;
    let known: std::collections::HashSet<String> = before
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["info"]["id"].as_str().map(str::to_string))
        .collect();
    send(app, id, text.to_string(), false).await?;
    if !wait {
        return Ok(json!({"delivered":true,"panel":id}));
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout.clamp(1, 180));
    loop {
        tokio::time::sleep(Duration::from_millis(350)).await;
        let snap = server.snapshot().await?;
        if snap["permissions"]
            .as_array()
            .is_some_and(|a| !a.is_empty())
            || snap["questions"].as_array().is_some_and(|a| !a.is_empty())
        {
            return Ok(json!({"delivered":true,"awaiting_user":true}));
        }
        let replies: Vec<String> = snap["messages"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|m| {
                m["info"]["role"] == "assistant"
                    && !known.contains(m["info"]["id"].as_str().unwrap_or(""))
            })
            .flat_map(|m| {
                m["parts"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|p| p["type"] == "text")
                    .filter_map(|p| p["text"].as_str().map(str::to_string))
            })
            .collect();
        if snap["status"]["type"] == "idle" && !replies.is_empty() {
            return Ok(json!({"delivered":true,"reply":replies.join("\n")}));
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(json!({"delivered":true,"timed_out":true}));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_ids_that_can_change_request_paths() {
        assert!(validate_id("ses_abc123", "ses").is_ok());
        for value in [
            "../session",
            "ses_a/abort",
            "ses_a?directory=elsewhere",
            "per_wrong",
        ] {
            assert!(validate_id(value, "ses").is_err());
        }
    }

    /// Explicit opt-in: native CLI + native PTY, loopback only, no model calls.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn live_opencode_server_and_terminal() {
        use std::io::{Read, Write};
        let path = std::env::var("TESSERA_OPENCODE_TEST_EXECUTABLE")
            .expect("Set TESSERA_OPENCODE_TEST_EXECUTABLE to a native OpenCode CLI");
        let root =
            std::env::temp_dir().join(format!("tessera-opencode-native-{}", uuid::Uuid::new_v4()));
        let cwd = root.join("project");
        std::fs::create_dir_all(&cwd).unwrap();
        let config = Config {
            cwd: cwd.to_string_lossy().into(),
            provider: "ollama".into(),
            model: "fixture".into(),
            base_url: "http://127.0.0.1:9/v1".into(),
            executable_path: path,
            permission: "ask".into(),
            agent: "build".into(),
            instructions: "Fixture instructions".into(),
            context_limit: 32768,
            output_limit: 4096,
            project_config: false,
            data_id: uuid::Uuid::new_v4().to_string(),
        };
        config.validate().unwrap();
        let server = launch_server(
            config.clone(),
            &root,
            "",
            config.runtime_config().unwrap(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            reqwest::get(format!("{}/session", server.url))
                .await
                .unwrap()
                .status(),
            401
        );
        let session=server.post("/session",json!({"title":"Tessera native fixture","agent":"build","model":{"providerID":"tessera-local","id":"fixture"}})).await.unwrap();
        let sid = session["id"].as_str().unwrap().to_string();
        *server.session_id.lock().unwrap() = sid.clone();
        watch_native_sessions(&server);
        server.post(&format!("/session/{sid}/message"),json!({"noReply":true,"parts":[{"type":"text","text":"Native terminal fixture history"}]})).await.unwrap();
        let snap = server.snapshot().await.unwrap();
        assert_eq!(snap["messages"].as_array().unwrap().len(), 1);

        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize {
                rows: 28,
                cols: 110,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = portable_pty::CommandBuilder::new(&server.executable.program);
        command.args(&server.executable.args);
        command.args([
            "attach",
            &server.url,
            "--dir",
            &server.config.cwd,
            "--session",
            &sid,
        ]);
        command.cwd(&server.config.cwd);
        command.env_clear();
        for (k, v) in &server.env {
            command.env(k, v);
        }
        let child = pair.slave.spawn_command(command).unwrap();
        struct PtyGuard(Box<dyn portable_pty::Child + Send + Sync>);
        impl Drop for PtyGuard {
            fn drop(&mut self) {
                if let Some(pid) = self.0.process_id() {
                    crate::util::proc::kill_tree(pid);
                }
                let _ = self.0.kill();
            }
        }
        let mut child = PtyGuard(child);
        drop(pair.slave);
        let mut writer = pair.master.take_writer().unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = [0u8; 16384];
            while let Ok(n) = reader.read(&mut bytes) {
                if n == 0 {
                    break;
                }
                if tx.send(bytes[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        let mut wire = String::new();
        while std::time::Instant::now() < deadline {
            if let Ok(bytes) = rx.recv_timeout(Duration::from_millis(200)) {
                let text = String::from_utf8_lossy(&bytes);
                wire.push_str(&text);
                if text.contains("\x1b[6n") {
                    let _ = writer.write_all(b"\x1b[1;1R");
                }
                if text.contains("\x1b[c") {
                    let _ = writer.write_all(b"\x1b[?1;2c");
                }
                if text.contains("\x1b]11;?") {
                    let _ = writer.write_all(b"\x1b]11;rgb:1111/1111/1b1b\x1b\\");
                }
                let _ = writer.flush();
                if wire.contains("Native terminal fixture history") {
                    break;
                }
            }
            if child.0.try_wait().unwrap().is_some() {
                break;
            }
        }
        assert!(
            wire.contains("Native terminal fixture history"),
            "TUI failed to render the pinned history: {}",
            wire.chars().take(4000).collect::<String>()
        );
        drop(child);
        drop(writer);
        drop(pair.master);
        let created = server
            .post("/session", json!({"title":"Native new conversation"}))
            .await
            .unwrap();
        let new_id = created["id"].as_str().unwrap();
        for _ in 0..30 {
            if server.sid() == new_id {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert_eq!(
            server.sid(),
            new_id,
            "TUI /new should update the saved identity"
        );
        let child_session = server
            .post("/session", json!({"title":"Subagent","parentID":new_id}))
            .await
            .unwrap();
        assert!(
            server
                .owns_request(child_session["id"].as_str().unwrap())
                .await
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            server.sid(),
            new_id,
            "Subagent must not replace the panel identity"
        );
        server.stop();
        let resumed = launch_server(
            config.clone(),
            &root,
            "",
            config.runtime_config().unwrap(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            resumed
                .get(&format!("/session/{sid}/message"))
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        resumed.stop();
    }
}
