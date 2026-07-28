use std::collections::HashMap;
use std::io::BufRead;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::util::claude_paths;

const MAIN_WINDOW_LABEL: &str = "main";

/// Per-instance state. Each instance tracks its config and current process.
/// A NEW Claude process is spawned for each user message (like opcode does).
pub struct StreamInstance {
    cwd: String,
    model: Option<String>,
    system_prompt: Option<String>,
    /// Claude's session ID, captured from the `init` system event.
    /// Used with `--resume` for subsequent messages in the same conversation.
    session_id: Option<String>,
    mcp_config_path: Option<String>,
    thinking_budget_tokens: Option<u32>,
    child: Option<Child>,
    kill_flag: Arc<Mutex<bool>>,
    message_count: u32,
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
}

/// Debug: push a test event via eval to verify the JS bridge works
#[tauri::command]
pub async fn stream_test_event(
    id: String,
    app: AppHandle,
) -> Result<String, String> {
    let test_payload = r#"{"type":"system","subtype":"init","session_id":"test-123","cwd":"C:\\test","tools":[]}"#;
    eprintln!("[stream-test] Pushing test event for id={} via eval", id);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let id_json = serde_json::to_string(&id).unwrap_or_default();
        let line_json = serde_json::to_string(test_payload).unwrap_or_default();
        let js = format!(
            "window.__streamPush && window.__streamPush({}, {})",
            id_json, line_json
        );
        match window.eval(&js) {
            Ok(_) => eprintln!("[stream-test] eval OK"),
            Err(e) => eprintln!("[stream-test] eval ERROR: {}", e),
        }
    } else {
        eprintln!("[stream-test] No '{}' webview window found!", MAIN_WINDOW_LABEL);
    }

    Ok(format!("Pushed test event for {}", id))
}

/// Initialize a stream instance with config. No process is spawned yet.
/// The actual Claude process is spawned on each `stream_send_message` call.
#[tauri::command]
pub async fn stream_spawn(
    id: String,
    cwd: String,
    model: Option<String>,
    system_prompt: Option<String>,
    session_id: Option<String>,
    mcp_config_path: Option<String>,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let work_dir = if cwd.is_empty() || cwd == "." {
        std::env::current_dir()
            .unwrap_or_else(|_| dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")))
            .to_string_lossy()
            .to_string()
    } else {
        cwd
    };

    let instance = StreamInstance {
        cwd: work_dir,
        model,
        system_prompt,
        session_id,
        mcp_config_path,
        thinking_budget_tokens: None,
        child: None,
        kill_flag: Arc::new(Mutex::new(false)),
        message_count: 0,
    };

    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;

    // Kill existing instance if any
    if let Some(mut old) = instances.remove(&id) {
        if let Ok(mut flag) = old.kill_flag.lock() {
            *flag = true;
        }
        if let Some(ref mut child) = old.child {
            let _ = child.kill();
        }
    }

    instances.insert(id, instance);
    Ok(())
}

/// Send a message by spawning a NEW Claude process with `-p "message"`.
/// First message starts a new session; subsequent messages use `--resume SESSION_ID`.
/// This matches how opcode handles Claude CLI interaction.
#[tauri::command]
pub async fn stream_send_message(
    id: String,
    message: String,
    app: AppHandle,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let claude_exe = claude_paths::find_claude_exe()
        .ok_or_else(|| "Could not find claude executable".to_string())?;

    // Extract config and kill any running process
    let (cwd, model, system_prompt, session_id, mcp_config_path, _thinking_budget_tokens, message_count) = {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances.get_mut(&id)
            .ok_or_else(|| format!("Stream instance '{}' not found. Call stream_spawn first.", id))?;

        // Kill existing process if still running
        if let Ok(mut flag) = instance.kill_flag.lock() {
            *flag = true;
        }
        if let Some(ref mut child) = instance.child {
            let _ = child.kill();
        }
        instance.child = None;
        instance.kill_flag = Arc::new(Mutex::new(false));

        let result = (
            instance.cwd.clone(),
            instance.model.clone(),
            instance.system_prompt.clone(),
            instance.session_id.clone(),
            instance.mcp_config_path.clone(),
            instance.thinking_budget_tokens,
            instance.message_count,
        );
        instance.message_count += 1;
        result
    };

    // Build command arguments
    let mut cmd = Command::new(&claude_exe);

    // Resume existing session or continue conversation
    if let Some(ref sid) = session_id {
        if !sid.is_empty() {
            cmd.arg("--resume").arg(sid);
        }
    } else if message_count > 0 {
        // No session_id captured yet but not the first message — use -c to continue
        cmd.arg("-c");
    }

    // The message itself
    cmd.arg("-p").arg(&message);

    // Output format — --verbose MUST come before --output-format stream-json
    cmd.arg("--verbose");
    cmd.arg("--output-format").arg("stream-json");

    // Model
    if let Some(ref m) = model {
        if !m.is_empty() {
            cmd.arg("--model").arg(m);
        }
    }

    // System prompt (only on first message)
    if let Some(ref sp) = system_prompt {
        if !sp.is_empty() && message_count == 0 {
            cmd.arg("--append-system-prompt").arg(sp);
        }
    }

    // MCP config
    if let Some(ref mcp) = mcp_config_path {
        if !mcp.is_empty() {
            cmd.arg("--mcp-config").arg(mcp);
        }
    }

    // NOTE: thinking budget is intentionally NOT passed as a CLI flag —
    // `--thinking-budget-tokens` does not exist in the claude CLI. The stored
    // value is applied via the control protocol (set_max_thinking_tokens) once
    // the persistent-process pipeline lands.

    // Skip permissions (like opcode) — no stdin to respond with
    cmd.arg("--dangerously-skip-permissions");

    cmd.current_dir(&cwd);

    // Use opcode's approach: clear ALL env vars and only inherit whitelisted ones.
    // This prevents CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, CLAUDE_EXE, etc. from
    // leaking into the child process, which would cause "cannot launch inside
    // another Claude Code session" errors.
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

    // No stdin needed — message is passed via -p flag
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // On Windows, prevent a visible console window from appearing
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // Debug: log the full command
    eprintln!("[stream:{}] Spawning: {:?}", id, cmd);

    // Resolve window handle once before spawning threads
    let window: WebviewWindow = app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| format!("No '{}' webview window found", MAIN_WINDOW_LABEL))?;

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    eprintln!("[stream:{}] Process spawned, PID: {}", id, child.id());

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            // Kill the child if we can't capture stdout — prevent process leak
            let _ = child.kill();
            return Err("Failed to capture stdout".to_string());
        }
    };
    let stderr = child.stderr.take();

    // Get references for the reader thread
    let instances_arc = state.instances.clone();
    let kill_flag = match state.instances.lock() {
        Ok(instances) => {
            match instances.get(&id) {
                Some(instance) => instance.kill_flag.clone(),
                None => {
                    let _ = child.kill();
                    return Err(format!("Stream instance '{}' disappeared", id));
                }
            }
        }
        Err(e) => {
            let _ = child.kill();
            return Err(e.to_string());
        }
    };

    // Store the child process. If this fails, kill the child to prevent leaks.
    match state.instances.lock() {
        Ok(mut instances) => {
            if let Some(instance) = instances.get_mut(&id) {
                instance.child = Some(child);
            } else {
                // Instance removed between lock acquisitions — kill to prevent leak
                // (stdout was already taken, so the process would be orphaned)
                // Note: child is moved into this block, drop will not kill it automatically
                let _ = child.kill();
            }
        }
        Err(e) => {
            let _ = child.kill();
            return Err(e.to_string());
        }
    }

    let reader_id = id.clone();
    let reader_window = window.clone();

    // Stdout reader thread — reads NDJSON lines and emits Tauri events
    std::thread::spawn(move || {
        eprintln!("[stream:{}] Reader thread started", reader_id);
        let reader = std::io::BufReader::new(stdout);
        let mut line_count = 0u32;
        for line in reader.lines() {
            // Check kill flag
            if let Ok(killed) = kill_flag.lock() {
                if *killed {
                    eprintln!("[stream:{}] Kill flag set, stopping reader", reader_id);
                    break;
                }
            }
            match line {
                Ok(text) => {
                    if text.trim().is_empty() { continue; }
                    line_count += 1;
                    let preview_end = text.char_indices().nth(200).map(|(i, _)| i).unwrap_or(text.len());
                    eprintln!("[stream:{}] Line {}: {}", reader_id, line_count, &text[..preview_end]);

                    // Extract session_id from init message
                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                        if msg["type"] == "system" && msg["subtype"] == "init" {
                            if let Some(sid) = msg["session_id"].as_str() {
                                eprintln!("[stream:{}] Captured session_id: {}", reader_id, sid);
                                if let Ok(mut instances) = instances_arc.lock() {
                                    if let Some(instance) = instances.get_mut(&reader_id) {
                                        if instance.session_id.is_none() {
                                            instance.session_id = Some(sid.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Bypass Tauri event system (emit/listen broken in WebView2).
                    // Instead, eval() JS directly into the webview via a global callback.
                    let id_json = serde_json::to_string(&reader_id).unwrap_or_default();
                    let line_json = serde_json::to_string(&text).unwrap_or_default();
                    let js = format!(
                        "window.__streamPush && window.__streamPush({}, {})",
                        id_json, line_json
                    );
                    if let Err(e) = reader_window.eval(&js) {
                        eprintln!("[stream:{}] EVAL ERROR: {}", reader_id, e);
                    }
                }
                Err(e) => {
                    eprintln!("[stream:{}] Read error: {}", reader_id, e);
                    break;
                }
            }
        }

        eprintln!("[stream:{}] Reader thread ending, read {} lines", reader_id, line_count);

        // Push exit signal via eval (bypasses broken Tauri event system)
        let id_json = serde_json::to_string(&reader_id).unwrap_or_default();
        let js = format!("window.__streamExit && window.__streamExit({})", id_json);
        let _ = reader_window.eval(&js);
    });

    // Stderr reader thread — log errors
    if let Some(stderr_stream) = stderr {
        let stderr_id = id.clone();
        let stderr_window = window;
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
                            let _ = stderr_window.eval(&js);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok(())
}

/// Permission responses are not needed when using --dangerously-skip-permissions.
/// Kept for API compatibility.
#[tauri::command]
pub async fn stream_respond_permission(
    id: String,
    allowed: bool,
    _state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    eprintln!(
        "[stream] Permission response for '{}': {} (no-op with --dangerously-skip-permissions)",
        id,
        if allowed { "allow" } else { "deny" }
    );
    Ok(())
}

#[tauri::command]
pub async fn stream_set_model(
    id: String,
    model: String,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    if let Some(instance) = instances.get_mut(&id) {
        instance.model = Some(model);
    }
    Ok(())
}

#[tauri::command]
pub async fn stream_kill(
    id: String,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    if let Some(instance) = instances.get_mut(&id) {
        if let Ok(mut flag) = instance.kill_flag.lock() {
            *flag = true;
        }
        if let Some(ref mut child) = instance.child {
            let _ = child.kill();
        }
        instance.child = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn stream_set_thinking(
    id: String,
    thinking_budget_tokens: Option<u32>,
    state: tauri::State<'_, StreamJsonManager>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    if let Some(instance) = instances.get_mut(&id) {
        instance.thinking_budget_tokens = thinking_budget_tokens;
    }
    Ok(())
}
