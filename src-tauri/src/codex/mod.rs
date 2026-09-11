pub mod executable;
pub mod rpc;

use rpc::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{atomic::Ordering, Arc, Mutex};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub cwd: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default = "default_sandbox")]
    pub sandbox: String,
    #[serde(default = "default_approval")]
    pub approval_policy: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub executable_path: String,
    #[serde(default)]
    pub terminal: bool,
}
fn default_sandbox() -> String {
    "workspace-write".into()
}
fn default_approval() -> String {
    "on-request".into()
}

impl Config {
    fn validate(&self) -> Result<(), String> {
        if !std::path::Path::new(&self.cwd).is_dir() {
            return Err("Choose an existing project folder for Codex.".into());
        }
        if !["read-only", "workspace-write", "danger-full-access"].contains(&self.sandbox.as_str())
        {
            return Err("Invalid Codex sandbox mode".into());
        }
        if !["on-request", "never"].contains(&self.approval_policy.as_str()) {
            return Err("Invalid Codex approval policy".into());
        }
        if !self
            .effort
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err("Invalid Codex reasoning effort".into());
        }
        Ok(())
    }
    fn wire_sandbox(&self) -> &str {
        match self.sandbox.as_str() {
            "read-only" => "read-only",
            "danger-full-access" => "danger-full-access",
            _ => "workspace-write",
        }
    }
}

pub struct Session {
    pub client: Arc<Client>,
    pub config: Config,
    pub initial: Value,
}

#[derive(Default)]
pub struct CodexManager {
    sessions: Mutex<HashMap<String, Session>>,
    discovery: Mutex<Option<Arc<Client>>>,
    gate: tokio::sync::Mutex<()>,
}
impl CodexManager {
    pub fn client(&self, id: &str) -> Result<Arc<Client>, String> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .map(|s| s.client.clone())
            .ok_or_else(|| "Codex panel is not configured. Open or retry the panel first.".into())
    }
    pub fn close(&self, id: &str) {
        if let Some(session) = self.sessions.lock().unwrap().remove(id) {
            session.client.stop();
        }
    }
    pub fn kill_all(&self) {
        for (_, session) in self.sessions.lock().unwrap().drain() {
            session.client.stop();
        }
        if let Some(client) = self.discovery.lock().unwrap().take() {
            client.stop();
        }
    }
    async fn discovery(&self, path: Option<&str>) -> Result<Arc<Client>, String> {
        let _gate = self.gate.lock().await;
        let exe = executable::resolve(path)?;
        {
            let existing = self.discovery.lock().unwrap();
            if let Some(c) = &*existing {
                if c.alive.load(Ordering::Acquire)
                    && c.executable.program == exe.program
                    && c.executable.args == exe.args
                {
                    return Ok(c.clone());
                }
            }
        }
        if let Some(old) = self.discovery.lock().unwrap().take() {
            old.stop();
        }
        let client = Client::spawn("_discovery", exe, false, HashMap::new(), None).await?;
        *self.discovery.lock().unwrap() = Some(client.clone());
        Ok(client)
    }
}

/// Convert only supported MCP transport shapes; never write global Codex config.
pub fn translate_servers(servers: Map<String, Value>) -> Result<Map<String, Value>, String> {
    let mut config = Map::new();
    for (name, server) in servers {
        // Config overrides use dotted paths, so server names must not introduce another key.
        if !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err(format!(
                "MCP server '{name}' must use letters, digits, underscores or hyphens for Codex."
            ));
        }
        if server["type"] == "sse" {
            return Err(format!("MCP server '{name}' uses legacy SSE, which this Codex integration does not support. Use Streamable HTTP."));
        }
        let mut value = Map::new();
        for key in ["command", "args", "env", "url"] {
            if let Some(v) = server.get(key) {
                value.insert(key.into(), v.clone());
            }
        }
        if let Some(v) = server.get("headers") {
            value.insert("http_headers".into(), v.clone());
        }
        if let Some(v) = server.get("bearer_token_env_var") {
            value.insert("bearer_token_env_var".into(), v.clone());
        }
        config.insert(format!("mcp_servers.{name}"), Value::Object(value));
    }
    Ok(config)
}

fn panel_overrides(
    app: &AppHandle,
    id: &str,
) -> Result<(Map<String, Value>, HashMap<String, String>), String> {
    let mut servers =
        crate::mcp::config::enabled_servers_json(&app.state::<crate::db::Database>())?;
    let mut env = HashMap::new();
    let bus = app.state::<crate::panelbus::PanelBus>();
    if let Some(port) = bus.port.filter(|_| bus.is_enabled()) {
        let env_name = "TESSERA_PANEL_BUS_TOKEN";
        env.insert(env_name.into(), bus.token_for(id));
        servers.insert(
            crate::panelbus::SERVER_NAME.into(),
            json!({
                "url":format!("http://127.0.0.1:{port}/mcp/{id}"),
                "bearer_token_env_var":env_name
            }),
        );
    }
    Ok((translate_servers(servers)?, env))
}

pub fn supported_request(method: &str) -> bool {
    matches!(
        method,
        "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
            | "item/permissions/requestApproval"
            | "item/tool/requestUserInput"
            | "mcpServer/elicitation/request"
    )
}

pub fn validate_response(request: &Value, response: &Value) -> Result<(), String> {
    let method = request["method"].as_str().unwrap_or("");
    match method {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            let decision = response["decision"].as_str().unwrap_or("");
            if !["accept", "acceptForSession", "decline", "cancel"].contains(&decision) {
                return Err("Invalid approval decision".into());
            }
            if let Some(available) = request["params"]["availableDecisions"].as_array() {
                if !available.contains(&response["decision"]) {
                    return Err("This decision was not offered by Codex".into());
                }
            }
        }
        "item/permissions/requestApproval" => {
            // UI supports denying or granting exactly the presented request for this turn.
            if response["permissions"] != json!({})
                && response["permissions"] != request["params"]["permissions"]
            {
                return Err("Permission response must match the displayed request".into());
            }
            if response.get("scope").is_some_and(|v| v != "turn") {
                return Err("Only turn-scoped grants are supported".into());
            }
        }
        "item/tool/requestUserInput" => {
            let questions = request["params"]["questions"]
                .as_array()
                .ok_or("Invalid question request")?;
            let answers = response["answers"].as_object().ok_or("Missing answers")?;
            for question in questions {
                let id = question["id"].as_str().ok_or("Missing question ID")?;
                if !answers
                    .get(id)
                    .and_then(|a| a["answers"].as_array())
                    .is_some_and(|a| !a.is_empty() && a.iter().all(Value::is_string))
                {
                    return Err("Answer each question before submitting".into());
                }
            }
        }
        "mcpServer/elicitation/request" => {
            if !["accept", "decline", "cancel"].contains(&response["action"].as_str().unwrap_or(""))
            {
                return Err("Invalid elicitation response".into());
            }
            if response["action"] == "accept" && request["params"]["mode"] != "url" {
                validate_form(&request["params"]["requestedSchema"], &response["content"])?;
            }
        }
        _ => return Err("Unsupported approval type".into()),
    }
    Ok(())
}

fn validate_form(schema: &Value, content: &Value) -> Result<(), String> {
    if schema["type"] != "object" {
        return Err("Unsupported MCP form schema".into());
    }
    let properties = schema["properties"]
        .as_object()
        .ok_or("Missing MCP form fields")?;
    let values = content.as_object().ok_or("Missing MCP form answers")?;
    if let Some(required) = schema["required"].as_array() {
        for key in required {
            if !values.contains_key(key.as_str().ok_or("Invalid required field")?) {
                return Err(format!("Missing required field: {key}"));
            }
        }
    }
    for (name, value) in values {
        let field = properties.get(name).ok_or("Unknown MCP form field")?;
        let valid = match field["type"].as_str().unwrap_or("") {
            "string" => value.as_str().is_some_and(|s| {
                let n = s.chars().count() as u64;
                !field["minLength"].as_u64().is_some_and(|min| n < min)
                    && !field["maxLength"].as_u64().is_some_and(|max| n > max)
            }),
            "boolean" => value.is_boolean(),
            "number" | "integer" => value.as_f64().is_some_and(|n| {
                (field["type"] != "integer" || n.fract() == 0.0)
                    && !field["minimum"].as_f64().is_some_and(|min| n < min)
                    && !field["maximum"].as_f64().is_some_and(|max| n > max)
            }),
            _ => false,
        };
        if !valid
            || field["enum"]
                .as_array()
                .is_some_and(|choices| !choices.contains(value))
            || field["oneOf"]
                .as_array()
                .is_some_and(|choices| !choices.iter().any(|c| c["const"] == *value))
        {
            return Err(format!("Invalid answer for {name}"));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn codex_discover(
    executable_path: Option<String>,
    state: tauri::State<'_, CodexManager>,
) -> Result<Value, String> {
    let c = state.discovery(executable_path.as_deref()).await?;
    let account = c
        .call("account/read", json!({"refreshToken":false}))
        .await?;
    let mut models = vec![];
    let mut cursor = Value::Null;
    loop {
        let page = c
            .call(
                "model/list",
                json!({"limit":100,"cursor":cursor,"includeHidden":false}),
            )
            .await?;
        models.extend(page["data"].as_array().cloned().unwrap_or_default());
        cursor = page["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    Ok(
        json!({"account":account,"models":models,"executable":c.executable.program.to_string_lossy()}),
    )
}

#[tauri::command]
pub async fn codex_history(
    cursor: Option<String>,
    search: Option<String>,
    executable_path: Option<String>,
    state: tauri::State<'_, CodexManager>,
) -> Result<Value, String> {
    let c = state.discovery(executable_path.as_deref()).await?;
    c.call("thread/list", json!({"cursor":cursor,"limit":50,"sortKey":"updated_at","searchTerm":search,"sourceKinds":[]})).await
}

#[tauri::command]
pub async fn codex_read_thread(
    thread_id: String,
    executable_path: Option<String>,
    state: tauri::State<'_, CodexManager>,
) -> Result<Value, String> {
    let c = state.discovery(executable_path.as_deref()).await?;
    c.call(
        "thread/read",
        json!({"threadId":thread_id,"includeTurns":true}),
    )
    .await
}

pub async fn configure(
    id: String,
    config: Config,
    thread_id: Option<String>,
    app: &AppHandle,
    manager: &CodexManager,
) -> Result<Value, String> {
    config.validate()?;
    let _gate = manager.gate.lock().await;
    {
        let sessions = manager.sessions.lock().unwrap();
        if let Some(s) = sessions.get(&id) {
            if s.client.alive.load(Ordering::Acquire) {
                return Ok(snapshot_session(s));
            }
        }
        if let Some(wanted) = &thread_id {
            for (other, session) in sessions.iter() {
                if other != &id && session.client.thread.lock().unwrap().as_ref() == Some(wanted) {
                    return Err("That Codex conversation is already open in another panel.".into());
                }
            }
        }
    }
    manager.close(&id);
    let (mut overrides, env) = panel_overrides(app, &id)?;
    overrides.insert("approvals_reviewer".into(), json!("user"));
    if !config.effort.is_empty() {
        overrides.insert("model_reasoning_effort".into(), json!(config.effort));
    }
    let client = Client::spawn(
        &id,
        executable::resolve(Some(&config.executable_path))?,
        config.terminal,
        env,
        Some(app.clone()),
    )
    .await?;
    let mut params = json!({
        "cwd":config.cwd,"sandbox":config.wire_sandbox(),"approvalPolicy":config.approval_policy,
        "approvalsReviewer":"user","config":overrides
    });
    if !config.model.is_empty() {
        params["model"] = json!(config.model);
    }
    let bus_instructions = crate::panelbus::MESSAGING_INSTRUCTIONS;
    params["developerInstructions"] =
        json!(format!("{}\n{}", config.instructions, bus_instructions));
    let method = if let Some(sid) = thread_id.filter(|s| !s.is_empty()) {
        *client.thread.lock().unwrap() = Some(sid.clone());
        params["threadId"] = json!(sid);
        "thread/resume"
    } else {
        "thread/start"
    };
    let initial = match client.call(method, params).await {
        Ok(value) => value,
        Err(e) => {
            client.stop();
            return Err(e);
        }
    };
    let sid = match initial["thread"]["id"].as_str() {
        Some(id) => id.to_string(),
        None => {
            client.stop();
            return Err("Codex returned no thread ID.".into());
        }
    };
    *client.thread.lock().unwrap() = Some(sid.clone());
    let session = Session {
        client: client.clone(),
        config,
        initial,
    };
    let snapshot = snapshot_session(&session);
    manager.sessions.lock().unwrap().insert(id, session);
    client.publish(json!({"method":"tessera/ready","params":{"threadId":sid}}));
    Ok(snapshot)
}

fn snapshot_session(s: &Session) -> Value {
    json!({"generation":s.client.generation,"thread":s.initial["thread"],
        "threadId":s.client.thread.lock().unwrap().clone(),
        "events":s.client.events.lock().unwrap().iter().cloned().collect::<Vec<_>>(),
        "requests":s.client.requests.lock().unwrap().values().cloned().collect::<Vec<_>>(),
        "busy":s.client.busy.load(Ordering::Acquire),"alive":s.client.alive.load(Ordering::Acquire)})
}

#[tauri::command]
pub async fn codex_configure(
    id: String,
    config: Config,
    thread_id: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, CodexManager>,
) -> Result<Value, String> {
    configure(id, config, thread_id, &app, &state).await
}

pub async fn send(
    manager: &CodexManager,
    id: &str,
    text: &str,
    images: Vec<String>,
    model: Option<String>,
    effort: Option<String>,
) -> Result<Value, String> {
    let mut input = Vec::new();
    if !text.trim().is_empty() {
        input.push(json!({"type":"text","text":text,"text_elements":[]}));
    }
    if images.len() > 8 {
        return Err("Attach up to 8 images per message.".into());
    }
    for image in images {
        if !image.starts_with("data:image/") {
            return Err("Only attached image data is accepted.".into());
        }
        input.push(json!({"type":"image","url":image}));
    }
    if input.is_empty() {
        return Err("Write a message or attach an image.".into());
    }
    let client = manager.client(id)?;
    if !client.requests.lock().unwrap().is_empty() {
        return Err("Answer this panel's pending request before sending another message.".into());
    }
    let sid = client.thread.lock().unwrap().clone().ok_or("Codex has no active thread")?;
    if client
        .busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("This Codex panel is already working. Stop or wait for it to finish.".into());
    }
    let mut params = json!({"threadId":sid,"input":input});
    if let Some(m) = model.filter(|m| !m.is_empty()) {
        params["model"] = json!(m);
    }
    if let Some(e) = effort.filter(|e| !e.is_empty()) {
        params["effort"] = json!(e);
    }
    match client.call("turn/start", params).await {
        // Activity and turn identity come from ordered turn notifications. A
        // fast completion can precede this reply: never revive its finished ID.
        Ok(result) => Ok(result),
        Err(e) => {
            client.busy.store(false, Ordering::Release);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn codex_send(
    id: String,
    text: String,
    images: Option<Vec<String>>,
    model: Option<String>,
    effort: Option<String>,
    state: tauri::State<'_, CodexManager>,
) -> Result<Value, String> {
    send(
        &state,
        &id,
        &text,
        images.unwrap_or_default(),
        model,
        effort,
    )
    .await
}

#[tauri::command]
pub async fn codex_interrupt(
    id: String,
    state: tauri::State<'_, CodexManager>,
) -> Result<(), String> {
    let c = state.client(&id)?;
    let turn = c.turn.lock().unwrap().clone();
    let thread = c.thread.lock().unwrap().clone();
    if let (Some(turn), Some(thread)) = (turn, thread) {
        c.call("turn/interrupt", json!({"threadId":thread,"turnId":turn}))
            .await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn codex_respond(
    id: String,
    request_id: Value,
    response: Value,
    state: tauri::State<'_, CodexManager>,
) -> Result<(), String> {
    let c = state.client(&id)?;
    let request = c
        .requests
        .lock()
        .unwrap()
        .get(&request_id.to_string())
        .cloned()
        .ok_or("This request has already been resolved.")?;
    validate_response(&request, &response)?;
    c.notify(json!({"id":request_id,"result":response}))?;
    c.requests.lock().unwrap().remove(&request_id.to_string());
    c.publish(json!({"method":"serverRequest/resolved","params":{"requestId":request_id}}));
    Ok(())
}

#[tauri::command]
pub async fn codex_close(id: String, state: tauri::State<'_, CodexManager>) -> Result<(), String> {
    // A close racing initial configuration must run after insertion, otherwise
    // a server could appear after its panel was already removed.
    let _gate = state.gate.lock().await;
    state.close(&id);
    Ok(())
}

#[tauri::command]
pub async fn codex_terminal_spawn(
    id: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: tauri::State<'_, CodexManager>,
    pty: tauri::State<'_, crate::pty::manager::PtyManager>,
) -> Result<(), String> {
    let c = state.client(&id)?;
    let endpoint = c.endpoint.as_ref().ok_or("This is not a terminal panel")?;
    let sid = c
        .thread
        .lock()
        .unwrap()
        .clone()
        .ok_or("Codex has no active thread")?;
    let config = state
        .sessions
        .lock()
        .unwrap()
        .get(&id)
        .ok_or("Missing configuration")?
        .config
        .clone();
    // First turn/start creates the transcript lazily. Wait until the TUI can
    // read it, without generating an artificial bootstrap message.
    let mut readable = false;
    for _ in 0..40 {
        match c
            .call("thread/read", json!({"threadId":sid,"includeTurns":true}))
            .await
        {
            Ok(_) => {
                readable = true;
                break;
            }
            Err(e) if e.contains("materialized") || e.contains("no rollout") => {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await
            }
            Err(e) => return Err(e),
        }
    }
    if !readable {
        return Err("Send the first message before attaching the Codex terminal.".into());
    }
    let mut cmd = portable_pty::CommandBuilder::new(&c.executable.program);
    cmd.args(&c.executable.args);
    cmd.args([
        "resume",
        "--remote",
        endpoint,
        "--remote-auth-token-env",
        "TESSERA_CODEX_REMOTE_TOKEN",
        &sid,
    ]);
    // A remote TUI must inherit the already configured thread's policy and
    // model. Codex rejects permission overrides on remote resume; passing CLI
    // -s/-a here prevents attachment instead of strengthening the policy.
    cmd.cwd(&config.cwd);
    cmd.env("TESSERA_CODEX_REMOTE_TOKEN", &c.token);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for key in [
        "CODEX_THREAD_ID",
        "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
        "CLAUDECODE",
        "CLAUDE_CODE_CHILD_SESSION",
    ] {
        cmd.env_remove(key);
    }
    crate::pty::manager::spawn_prepared(id, cmd, cols, rows, &app, &pty)
}

pub async fn deliver(
    app: &AppHandle,
    id: &str,
    text: &str,
    wait: bool,
    timeout: u64,
) -> Result<Value, String> {
    let manager = app.state::<CodexManager>();
    if manager.client(id).is_err() {
        let bus = app.state::<crate::panelbus::PanelBus>();
        let info = bus
            .with_registry(|r| r.get(id).cloned())
            .ok_or("Unknown Codex panel")?;
        let config = info
            .codex_config
            .ok_or("Codex panel has no configuration")?;
        configure(id.into(), config, info.session_id, app, &manager).await?;
    }
    let c = manager.client(id)?;
    let mut watcher = c.outcomes.subscribe();
    let result = send(&manager, id, text, vec![], None, None).await?;
    if !wait {
        return Ok(json!({"delivered":true,"turnId":result["turn"]["id"]}));
    }
    match tokio::time::timeout(
        std::time::Duration::from_secs(timeout.clamp(5, 120)),
        watcher.recv(),
    )
    .await
    {
        Ok(Ok(outcome)) => {
            let reply = read_recent(app, id, 10).await.unwrap_or(json!([]));
            Ok(json!({"delivered":true,"outcome":outcome,"messages":reply}))
        }
        _ => Ok(json!({"delivered":true,"status":"timed_out"})),
    }
}

pub async fn read_recent(app: &AppHandle, id: &str, limit: usize) -> Result<Value, String> {
    let manager = app.state::<CodexManager>();
    let (c, sid) = match manager.client(id) {
        Ok(c) => {
            let sid = c
                .thread
                .lock()
                .unwrap()
                .clone()
                .ok_or("No Codex conversation")?;
            (c, sid)
        }
        Err(_) => {
            let bus = app.state::<crate::panelbus::PanelBus>();
            let info = bus
                .with_registry(|r| r.get(id).cloned())
                .ok_or("Unknown Codex panel")?;
            let Some(sid) = info.session_id else {
                return Ok(json!([]));
            };
            let path = info
                .codex_config
                .as_ref()
                .map(|c| c.executable_path.as_str());
            (manager.discovery(path).await?, sid)
        }
    };
    let data = c
        .call("thread/read", json!({"threadId":sid,"includeTurns":true}))
        .await?;
    let turns = data["thread"]["turns"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    Ok(json!(turns
        .into_iter()
        .rev()
        .take(limit)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mcp_conversion_preserves_transport_and_rejects_sse() {
        let input = json!({"local":{"command":"node","args":["server.js"],"env":{"MODE":"test"}},"remote":{"type":"http","url":"http://127.0.0.1:1234","headers":{"X-Test":"yes"}}});
        let result = translate_servers(input.as_object().unwrap().clone()).unwrap();
        assert_eq!(result["mcp_servers.local"]["args"], json!(["server.js"]));
        assert_eq!(
            result["mcp_servers.remote"]["http_headers"]["X-Test"],
            "yes"
        );
        assert!(translate_servers(
            json!({"legacy":{"type":"sse"}})
                .as_object()
                .unwrap()
                .clone()
        )
        .is_err());
    }
    #[test]
    fn approval_choices_cannot_be_escalated() {
        let request = json!({"method":"item/commandExecution/requestApproval","params":{"availableDecisions":["decline","cancel"]}});
        assert!(validate_response(&request, &json!({"decision":"accept"})).is_err());
        assert!(validate_response(&request, &json!({"decision":"decline"})).is_ok());
        assert!(!supported_request("attestation/generate"));
    }
    #[test]
    fn permissions_are_not_expandable() {
        let request = json!({"method":"item/permissions/requestApproval","params":{"permissions":{"network":{"enabled":true}}}});
        assert!(validate_response(&request, &json!({"permissions":{},"scope":"turn"})).is_ok());
        assert!(validate_response(
            &request,
            &json!({"permissions":{"filesystem":{"write":["C:/"]}}})
        )
        .is_err());
    }
    #[test]
    fn form_responses_must_match_presented_schema() {
        let schema = json!({"type":"object","properties":{"count":{"type":"integer","minimum":1,"maximum":5},"mode":{"type":"string","enum":["slow","fast"]}},"required":["count"]});
        assert!(validate_form(&schema, &json!({"count":3,"mode":"slow"})).is_ok());
        assert!(validate_form(&schema, &json!({"count":6})).is_err());
        assert!(validate_form(&schema, &json!({"count":3,"mode":"unexpected"})).is_err());
        assert!(validate_form(&schema, &json!({})).is_err());
    }
}
