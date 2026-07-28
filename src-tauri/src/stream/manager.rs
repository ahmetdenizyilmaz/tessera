//! Persistent stream-JSON chat pipeline.
//!
//! One long-lived `claude` process per chat instance:
//!   claude -p --verbose --input-format stream-json --output-format stream-json
//! User turns are written to the child's stdin as JSONL; output lines are
//! batched and pushed into the webview via `window.__streamPushBatch` (the
//! Tauri emit/listen path does not deliver to WebView2, so we eval()).
//!
//! The SDK control protocol runs over the same pipes:
//!   CLI → app:  {"type":"control_request","request_id":R,"request":{...}}
//!   app → CLI:  {"type":"control_response","response":{"subtype":"success",...}}
//! plus app-initiated requests (interrupt, set_model, set_permission_mode,
//! set_max_thinking_tokens).

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::util::claude_paths;

const MAIN_WINDOW_LABEL: &str = "main";
const BATCH_MAX_LINES: usize = 64;
const BATCH_WINDOW_MS: u64 = 16;

#[derive(Clone, Default)]
pub struct StreamConfig {
    pub cwd: String,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub mcp_config_path: Option<String>,
    pub permission_mode: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub dangerously_skip_permissions: bool,
    pub thinking_budget_tokens: Option<u32>,
}

pub struct StreamInstance {
    config: StreamConfig,
    /// Claude's session id — refreshed from EVERY system/init event, so
    /// respawns and /clear always resume the right conversation.
    session_id: Option<String>,
    child: Option<Child>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    /// Bumped on every spawn/clear/kill. Reader threads carry the generation
    /// they were spawned with and stop pumping when it no longer matches.
    generation: u64,
    request_counter: u64,
}

pub struct StreamJsonManager {
    pub instances: Arc<Mutex<HashMap<String, StreamInstance>>>,
}

impl StreamJsonManager {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Kill every running stream child. Called on app exit so no claude.exe
    /// processes outlive the window.
    pub fn kill_all(&self) {
        if let Ok(mut instances) = self.instances.lock() {
            for (_, mut instance) in instances.drain() {
                instance.generation += 1;
                instance.stdin = None;
                if let Some(mut child) = instance.child.take() {
                    crate::util::proc::kill_tree(child.id());
                    let _ = child.kill();
                }
            }
        }
    }
}

/// Tear down an instance's process (if any). `graceful` closes stdin first
/// and gives the CLI 3 s to exit on its own before the tree-kill.
fn teardown_process(instance: &mut StreamInstance, graceful: bool) {
    instance.generation += 1;
    let stdin = instance.stdin.take();
    let child = instance.child.take();
    drop(stdin); // closes the pipe → CLI sees EOF and exits cleanly

    if let Some(mut child) = child {
        let pid = child.id();
        if graceful {
            std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(3);
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => return,
                        Ok(None) => {
                            if Instant::now() >= deadline {
                                crate::util::proc::kill_tree(pid);
                                let _ = child.kill();
                                return;
                            }
                            std::thread::sleep(Duration::from_millis(100));
                        }
                        Err(_) => return,
                    }
                }
            });
        } else {
            crate::util::proc::kill_tree(pid);
            let _ = child.kill();
        }
    }
}

fn eval_batch(window: &WebviewWindow, id: &str, batch: &[String]) {
    if batch.is_empty() {
        return;
    }
    let id_json = serde_json::to_string(id).unwrap_or_default();
    let lines_json = serde_json::to_string(batch).unwrap_or_default();
    let js = format!(
        "window.__streamPushBatch && window.__streamPushBatch({}, {})",
        id_json, lines_json
    );
    if let Err(e) = window.eval(&js) {
        eprintln!("[stream:{}] batch eval error: {}", id, e);
    }
}

/// Write one JSONL value to the child's stdin.
fn write_line(stdin: &Arc<Mutex<ChildStdin>>, value: &serde_json::Value) -> Result<(), String> {
    let mut guard = stdin.lock().map_err(|e| e.to_string())?;
    let mut s = serde_json::to_string(value).map_err(|e| e.to_string())?;
    s.push('\n');
    guard
        .write_all(s.as_bytes())
        .map_err(|e| format!("stdin write failed: {}", e))?;
    guard.flush().map_err(|e| format!("stdin flush failed: {}", e))
}

/// Get the live stdin handle for an instance, if its process is running.
fn get_stdin(
    state: &tauri::State<'_, StreamJsonManager>,
    id: &str,
) -> Result<Arc<Mutex<ChildStdin>>, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    instances
        .get(id)
        .and_then(|i| i.stdin.clone())
        .ok_or_else(|| format!("No running claude process for instance '{}'", id))
}

/// Spawn the persistent claude process for an instance if it is not already
/// running. Holds the instances lock for the duration of the spawn (fast).
fn ensure_process(
    id: &str,
    app: &AppHandle,
    state: &tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let claude_exe = claude_paths::find_claude_exe()
        .ok_or_else(|| "Could not find claude executable".to_string())?;
    let window: WebviewWindow = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| format!("No '{}' webview window found", MAIN_WINDOW_LABEL))?;

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances
        .get_mut(id)
        .ok_or_else(|| format!("Stream instance '{}' not found. Call stream_configure first.", id))?;

    // Already running?
    if let Some(child) = instance.child.as_mut() {
        match child.try_wait() {
            Ok(None) => return Ok(()), // alive
            _ => {
                // exited on its own — clean the stale handles
                instance.child = None;
                instance.stdin = None;
            }
        }
    }

    let cfg = instance.config.clone();

    // Resume only when the session file actually exists — the CLI errors out
    // ("No conversation found with session ID: …") instead of falling back.
    let resume_sid = instance.session_id.clone().filter(|sid| {
        if sid.is_empty() {
            return false;
        }
        let exists = claude_paths::session_file_path(&cfg.cwd, sid).exists();
        if !exists {
            eprintln!("[stream:{}] session {} has no file on disk — not resuming", id, sid);
        }
        exists
    });

    let mut cmd = Command::new(&claude_exe);
    cmd.arg("-p");
    cmd.arg("--verbose");
    cmd.arg("--input-format").arg("stream-json");
    cmd.arg("--output-format").arg("stream-json");

    if let Some(ref sid) = resume_sid {
        cmd.arg("--resume").arg(sid);
    }
    if let Some(ref m) = cfg.model {
        if !m.is_empty() {
            cmd.arg("--model").arg(m);
        }
    }
    if let Some(ref sp) = cfg.system_prompt {
        if !sp.is_empty() {
            cmd.arg("--append-system-prompt").arg(sp);
        }
    }
    if let Some(ref mcp) = cfg.mcp_config_path {
        if !mcp.is_empty() {
            cmd.arg("--mcp-config").arg(mcp);
        }
    }
    let mode = cfg.permission_mode.as_deref().unwrap_or("default");
    if mode != "default" {
        cmd.arg("--permission-mode").arg(mode);
    }
    if let Some(ref tools) = cfg.allowed_tools {
        for tool in tools {
            if !tool.is_empty() {
                cmd.arg("--allowedTools").arg(tool);
            }
        }
    }
    // TODO(interactive-prompts): replace this interim bypass with
    // `--permission-prompt-tool stdio` once the frontend can answer
    // can_use_tool control requests (permission cards / AskUserQuestion UI).
    if cfg.dangerously_skip_permissions || mode == "default" {
        cmd.arg("--dangerously-skip-permissions");
    }

    cmd.current_dir(&cfg.cwd);

    // Clear ALL env vars and only inherit whitelisted ones. Prevents
    // CLAUDECODE / CLAUDE_CODE_ENTRYPOINT etc. from leaking into the child,
    // which would trigger "cannot launch inside another Claude Code session".
    cmd.env_clear();
    for (key, value) in std::env::vars() {
        let dominated = matches!(key.as_str(),
            "PATH" | "HOME" | "USERPROFILE" | "USERNAME" | "USER"
            | "SHELL" | "COMSPEC" | "LANG" | "TERM"
            | "NODE_PATH" | "NVM_DIR" | "NVM_BIN" | "NVM_SYMLINK"
            | "TEMP" | "TMP" | "APPDATA" | "LOCALAPPDATA"
            | "SystemRoot" | "SYSTEMROOT" | "windir" | "SystemDrive"
            | "HOMEDRIVE" | "HOMEPATH"
            | "ProgramFiles" | "ProgramData" | "CommonProgramFiles"
            | "HTTP_PROXY" | "HTTPS_PROXY" | "NO_PROXY"
            | "http_proxy" | "https_proxy" | "no_proxy"
            | "PROCESSOR_ARCHITECTURE" | "NUMBER_OF_PROCESSORS"
            | "OS" | "PATHEXT"
        );
        let prefix_match = key.starts_with("LC_");
        if dominated || prefix_match {
            cmd.env(&key, &value);
        }
    }

    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    eprintln!("[stream:{}] Spawning persistent process: {:?}", id, cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;
    eprintln!("[stream:{}] PID {}", id, child.id());

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            return Err("Failed to capture stdout".to_string());
        }
    };
    let stderr = child.stderr.take();
    let stdin = match child.stdin.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            return Err("Failed to capture stdin".to_string());
        }
    };

    instance.generation += 1;
    let my_gen = instance.generation;
    instance.child = Some(child);
    instance.stdin = Some(Arc::new(Mutex::new(stdin)));
    drop(instances);

    let instances_arc = state.instances.clone();
    let (tx, rx) = mpsc::channel::<String>();
    let exit_code: Arc<Mutex<Option<i32>>> = Arc::new(Mutex::new(None));

    // Emitter thread: batches lines into __streamPushBatch evals, then
    // signals __streamExit once the channel closes.
    {
        let window = window.clone();
        let emitter_id = id.to_string();
        let exit_code = exit_code.clone();
        std::thread::spawn(move || {
            loop {
                let first = match rx.recv() {
                    Ok(l) => l,
                    Err(_) => break,
                };
                let mut batch = vec![first];
                let deadline = Instant::now() + Duration::from_millis(BATCH_WINDOW_MS);
                while batch.len() < BATCH_MAX_LINES {
                    let now = Instant::now();
                    if now >= deadline {
                        break;
                    }
                    match rx.recv_timeout(deadline - now) {
                        Ok(l) => batch.push(l),
                        Err(_) => break,
                    }
                }
                eval_batch(&window, &emitter_id, &batch);
            }
            let code = exit_code.lock().ok().and_then(|g| *g);
            let id_json = serde_json::to_string(&emitter_id).unwrap_or_default();
            let code_json = match code {
                Some(c) => c.to_string(),
                None => "null".to_string(),
            };
            let js = format!(
                "window.__streamExit && window.__streamExit({}, {})",
                id_json, code_json
            );
            let _ = window.eval(&js);
        });
    }

    // Stdout reader thread: pumps NDJSON lines into the emitter channel and
    // refreshes the captured session id from every system/init event.
    {
        let reader_id = id.to_string();
        let instances_arc = instances_arc.clone();
        let exit_code = exit_code.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                let text = match line {
                    Ok(t) => t,
                    Err(_) => break,
                };
                if text.trim().is_empty() {
                    continue;
                }

                // Stop pumping if this process was replaced or cleared
                let stale = match instances_arc.lock() {
                    Ok(instances) => !matches!(
                        instances.get(&reader_id),
                        Some(inst) if inst.generation == my_gen
                    ),
                    Err(_) => true,
                };
                if stale {
                    break;
                }

                // Capture/refresh session_id from init events
                if text.len() < 65536 && text.contains("\"subtype\":\"init\"") {
                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                        if msg["type"] == "system" && msg["subtype"] == "init" {
                            if let Some(sid) = msg["session_id"].as_str() {
                                if let Ok(mut instances) = instances_arc.lock() {
                                    if let Some(inst) = instances.get_mut(&reader_id) {
                                        if inst.generation == my_gen {
                                            inst.session_id = Some(sid.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if tx.send(text).is_err() {
                    break;
                }
            }

            // EOF (or stale): if still the current generation, take the child
            // out and reap it WITHOUT holding the map lock.
            let child_opt = match instances_arc.lock() {
                Ok(mut instances) => match instances.get_mut(&reader_id) {
                    Some(inst) if inst.generation == my_gen => {
                        inst.stdin = None;
                        inst.child.take()
                    }
                    _ => None,
                },
                Err(_) => None,
            };
            let mut code: Option<i32> = None;
            if let Some(mut child) = child_opt {
                let deadline = Instant::now() + Duration::from_secs(2);
                loop {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            code = status.code();
                            break;
                        }
                        Ok(None) if Instant::now() < deadline => {
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        _ => {
                            crate::util::proc::kill_tree(child.id());
                            let _ = child.kill();
                            break;
                        }
                    }
                }
            }
            if let Ok(mut g) = exit_code.lock() {
                *g = code;
            }
            // Dropping tx ends the emitter thread → __streamExit fires
        });
    }

    // Stderr reader thread — forwards lines to __streamError (the frontend
    // classifies fatal vs warning).
    if let Some(stderr_stream) = stderr {
        let stderr_id = id.to_string();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr_stream);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        if !text.trim().is_empty() {
                            eprintln!("[claude-stderr:{}] {}", stderr_id, text);
                            let id_json = serde_json::to_string(&stderr_id).unwrap_or_default();
                            let err_json = serde_json::to_string(&text).unwrap_or_default();
                            let js = format!(
                                "window.__streamError && window.__streamError({}, {})",
                                id_json, err_json
                            );
                            let _ = window.eval(&js);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok(())
}

/// Register or update an instance's config. Idempotent — never touches a
/// running process, so callers can invoke it freely on mount/remount.
#[tauri::command]
pub async fn stream_configure(
    id: String,
    cwd: String,
    model: Option<String>,
    system_prompt: Option<String>,
    session_id: Option<String>,
    mcp_config_path: Option<String>,
    permission_mode: Option<String>,
    allowed_tools: Option<Vec<String>>,
    dangerously_skip_permissions: Option<bool>,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let work_dir = claude_paths::resolve_work_dir(&cwd);
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;

    if let Some(instance) = instances.get_mut(&id) {
        instance.config.cwd = work_dir;
        instance.config.model = model;
        instance.config.system_prompt = system_prompt;
        instance.config.mcp_config_path = mcp_config_path;
        instance.config.permission_mode = permission_mode;
        instance.config.allowed_tools = allowed_tools;
        instance.config.dangerously_skip_permissions =
            dangerously_skip_permissions.unwrap_or(false);
        if instance.session_id.is_none() {
            instance.session_id = session_id.filter(|s| !s.is_empty());
        }
    } else {
        instances.insert(
            id,
            StreamInstance {
                config: StreamConfig {
                    cwd: work_dir,
                    model,
                    system_prompt,
                    mcp_config_path,
                    permission_mode,
                    allowed_tools,
                    dangerously_skip_permissions: dangerously_skip_permissions.unwrap_or(false),
                    thinking_budget_tokens: None,
                },
                session_id: session_id.filter(|s| !s.is_empty()),
                child: None,
                stdin: None,
                generation: 0,
                request_counter: 0,
            },
        );
    }
    Ok(())
}

/// Send a user turn. Spawns the persistent process lazily on first use and
/// respawns (resuming the session) if the previous process died.
#[tauri::command]
pub async fn stream_send_message(
    id: String,
    message: String,
    app: AppHandle,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    ensure_process(&id, &app, &state)?;

    let payload = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": message }
    });

    let stdin = get_stdin(&state, &id)?;
    if let Err(first_err) = write_line(&stdin, &payload) {
        eprintln!("[stream:{}] write failed ({}), respawning once", id, first_err);
        // Process likely died — tear down and retry once with --resume.
        {
            let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
            if let Some(instance) = instances.get_mut(&id) {
                teardown_process(instance, false);
            }
        }
        ensure_process(&id, &app, &state)?;
        let stdin = get_stdin(&state, &id)?;
        write_line(&stdin, &payload)?;
    }
    Ok(())
}

/// Answer a control request from the CLI (permission prompt, AskUserQuestion,
/// plan approval). `response` is the inner payload, e.g.
/// {"behavior":"allow","updatedInput":{...}}.
#[tauri::command]
pub async fn stream_control_response(
    id: String,
    request_id: String,
    response: serde_json::Value,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let envelope = serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": response
        }
    });
    let stdin = get_stdin(&state, &id)?;
    write_line(&stdin, &envelope)
}

/// Send an app-initiated control request (interrupt, set_model,
/// set_permission_mode, set_max_thinking_tokens, …). `payload` holds the
/// subtype-specific fields.
#[tauri::command]
pub async fn stream_control_request(
    id: String,
    subtype: String,
    payload: Option<serde_json::Value>,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<String, String> {
    let request_id = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(&id)
            .ok_or_else(|| format!("Stream instance '{}' not found", id))?;
        instance.request_counter += 1;
        format!("req_{}_{}", instance.request_counter, std::process::id())
    };

    let mut request = serde_json::Map::new();
    request.insert("subtype".to_string(), serde_json::Value::String(subtype));
    if let Some(serde_json::Value::Object(extra)) = payload {
        for (k, v) in extra {
            request.insert(k, v);
        }
    }

    let envelope = serde_json::json!({
        "type": "control_request",
        "request_id": request_id,
        "request": serde_json::Value::Object(request)
    });
    let stdin = get_stdin(&state, &id)?;
    write_line(&stdin, &envelope)?;
    Ok(request_id)
}

/// Real /clear: end the current process (graceful EOF, then kill), forget the
/// session id, keep the config. The next send starts a brand-new conversation.
#[tauri::command]
pub async fn stream_clear(
    id: String,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    if let Some(instance) = instances.get_mut(&id) {
        teardown_process(instance, true);
        instance.session_id = None;
    }
    Ok(())
}

/// Tab close: tear everything down and drop the instance entry.
#[tauri::command]
pub async fn stream_kill(
    id: String,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    if let Some(mut instance) = instances.remove(&id) {
        teardown_process(&mut instance, false);
    }
    Ok(())
}

/// Update the model; applies live via the control protocol when running.
#[tauri::command]
pub async fn stream_set_model(
    id: String,
    model: String,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let stdin_opt = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(&id)
            .ok_or_else(|| format!("Stream instance '{}' not found", id))?;
        instance.config.model = Some(model.clone());
        instance.request_counter += 1;
        instance
            .stdin
            .clone()
            .map(|s| (s, format!("req_{}_{}", instance.request_counter, std::process::id())))
    };
    if let Some((stdin, request_id)) = stdin_opt {
        let envelope = serde_json::json!({
            "type": "control_request",
            "request_id": request_id,
            "request": { "subtype": "set_model", "model": model }
        });
        // Best-effort: if the process just died, the next spawn picks the
        // model up from config anyway.
        let _ = write_line(&stdin, &envelope);
    }
    Ok(())
}

/// Update the thinking budget; applies live via set_max_thinking_tokens.
#[tauri::command]
pub async fn stream_set_thinking(
    id: String,
    thinking_budget_tokens: Option<u32>,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let stdin_opt = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(&id)
            .ok_or_else(|| format!("Stream instance '{}' not found", id))?;
        instance.config.thinking_budget_tokens = thinking_budget_tokens;
        instance.request_counter += 1;
        instance
            .stdin
            .clone()
            .map(|s| (s, format!("req_{}_{}", instance.request_counter, std::process::id())))
    };
    if let Some((stdin, request_id)) = stdin_opt {
        let tokens_value = match thinking_budget_tokens {
            Some(n) => serde_json::json!(n),
            None => serde_json::Value::Null,
        };
        let envelope = serde_json::json!({
            "type": "control_request",
            "request_id": request_id,
            "request": { "subtype": "set_max_thinking_tokens", "max_thinking_tokens": tokens_value }
        });
        let _ = write_line(&stdin, &envelope);
    }
    Ok(())
}
