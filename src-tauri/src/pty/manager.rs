use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

use crate::util::claude_paths;

const BUFFER_MAX: usize = 1024 * 1024; // 1MB
const BUFFER_KEEP: usize = 512 * 1024; // 512KB on drain

pub struct PtyInstance {
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    /// Handle to the spawned claude process — required to actually kill it.
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Option<Box<dyn Write + Send>>,
    output_buffer: Arc<Mutex<Vec<u8>>>,
    kill_flag: Arc<Mutex<bool>>,
    suppress_events: Arc<AtomicBool>,
}

fn kill_instance(instance: &mut PtyInstance) {
    if let Ok(mut flag) = instance.kill_flag.lock() {
        *flag = true;
    }
    // Tree-kill first: a claude.cmd shim spawns node.exe children that a
    // plain kill() would orphan.
    if let Some(pid) = instance.child.process_id() {
        crate::util::proc::kill_tree(pid);
    }
    let _ = instance.child.kill();
    instance.writer = None;
}

pub struct PtyManager {
    instances: Arc<Mutex<HashMap<String, PtyInstance>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Kill every running PTY child. Called on app exit so no claude.exe
    /// processes outlive the window.
    pub fn kill_all(&self) {
        if let Ok(mut instances) = self.instances.lock() {
            for (_, mut instance) in instances.drain() {
                kill_instance(&mut instance);
            }
        }
    }
}

/// Which session flag to spawn with. `Resume` continues an existing JSONL;
/// `New` pins the id of a conversation that does not exist yet, so the panel
/// knows its session id without having to guess afterwards.
pub enum SessionArg {
    Resume(String),
    New(String),
}

fn build_claude_args(
    model: &Option<String>,
    dangerously_skip_permissions: bool,
    permission_mode: &Option<String>,
    allowed_tools: &Option<Vec<String>>,
    system_prompt: &Option<String>,
    session: &Option<SessionArg>,
    mcp_config_path: &Option<String>,
    panel_mcp_config: &Option<String>,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    if let Some(m) = model {
        if !m.is_empty() {
            args.push("--model".to_string());
            args.push(m.clone());
        }
    }

    if dangerously_skip_permissions {
        args.push("--dangerously-skip-permissions".to_string());
    }

    if let Some(pm) = permission_mode {
        if !pm.is_empty() && pm != "default" {
            args.push("--permission-mode".to_string());
            args.push(pm.clone());
        }
    }

    if let Some(tools) = allowed_tools {
        for tool in tools {
            if !tool.is_empty() {
                args.push("--allowedTools".to_string());
                args.push(tool.clone());
            }
        }
    }

    if let Some(sp) = system_prompt {
        if !sp.is_empty() {
            args.push("--append-system-prompt".to_string());
            args.push(sp.clone());
        }
    }

    match session {
        Some(SessionArg::Resume(sid)) => {
            args.push("--resume".to_string());
            args.push(sid.clone());
        }
        Some(SessionArg::New(sid)) => {
            args.push("--session-id".to_string());
            args.push(sid.clone());
        }
        None => {}
    }

    if let Some(mcp) = mcp_config_path {
        if !mcp.is_empty() {
            args.push("--mcp-config".to_string());
            args.push(mcp.clone());
        }
    }

    // The merged panel-bus + McpManager config (see stream/manager.rs for why
    // it is built at spawn time and why --strict-mcp-config is not used).
    if let Some(path) = panel_mcp_config {
        args.push("--mcp-config".to_string());
        args.push(path.clone());
        args.push("--allowedTools".to_string());
        args.push(crate::panelbus::spawn_config::allowed_tool_pattern());
    }

    if let Some(dir) = crate::panelbus::plugin::plugin_dir() {
        args.push("--plugin-dir".to_string());
        args.push(dir.to_string_lossy().to_string());
    }

    args
}

#[tauri::command]
pub async fn pty_spawn(
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    model: Option<String>,
    dangerously_skip_permissions: Option<bool>,
    permission_mode: Option<String>,
    allowed_tools: Option<Vec<String>>,
    system_prompt: Option<String>,
    claude_session_id: Option<String>,
    mcp_config_path: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, PtyManager>,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Auto-generate MCP config from database if not explicitly provided
    let effective_mcp_config = if mcp_config_path.is_some() {
        mcp_config_path
    } else {
        // Try to generate from DB - if the Database state is available
        // This is a best-effort; if DB is not available, we proceed without MCP
        None
    };

    // Resolve the working directory BEFORE building args — the resume guard
    // below needs it to locate the session file.
    let work_dir = claude_paths::resolve_work_dir(&cwd);

    // The panel always hands us an id. If its JSONL already exists we resume
    // it; if not we pass --session-id so the CLI *starts* the conversation
    // under that exact id.
    //
    // The alternative — let the CLI pick an id and then work out which file it
    // created — cannot be done reliably: the only signal is "newest session in
    // this directory", which silently adopts an unrelated conversation whenever
    // two panels share a working directory, or when a Claude Code session was
    // run in that directory outside the app. That is exactly how panels ended
    // up showing each other's transcripts after a restart.
    let session_arg = claude_session_id
        .filter(|sid| !sid.is_empty())
        .map(|sid| {
            let exists = claude_paths::session_file_path(&work_dir, &sid).exists();
            if exists {
                SessionArg::Resume(sid)
            } else {
                SessionArg::New(sid)
            }
        });

    let args = build_claude_args(
        &model,
        dangerously_skip_permissions.unwrap_or(false),
        &permission_mode,
        &allowed_tools,
        &system_prompt,
        &session_arg,
        &effective_mcp_config,
        &crate::panelbus::spawn_config::write_for_panel(&app, &id),
    );

    let claude_exe = claude_paths::find_claude_exe()
        .ok_or_else(|| "Could not find claude executable on this system. Check that claude is installed and in your PATH.".to_string())?;

    let mut cmd = CommandBuilder::new(&claude_exe);
    for arg in &args {
        cmd.arg(arg);
    }

    cmd.cwd(&work_dir);

    // Strip nested-session markers: if the GUI itself was launched from
    // inside a Claude Code session (e.g. `tauri dev` in a CC terminal), the
    // PTY child would otherwise think it's a child session — refusing to
    // start ("cannot launch inside another session") or silently disabling
    // transcript saving ("inherited CLAUDE_CODE_CHILD_SESSION marker").
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");
    cmd.env_remove("CLAUDE_CODE_CHILD_SESSION");
    cmd.env_remove("CLAUDE_EXE");

    // Windows ConPTY sets no TERM, so the CLI's color detection (chalk /
    // supports-color) falls back to "no color" and the whole TUI renders
    // plain white. Declare a 256-color truecolor terminal — xterm.js is one.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("FORCE_COLOR", "3");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    // Drop slave after spawning - we only need the master side
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let output_buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let kill_flag: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
    let suppress_events: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

    let instance = PtyInstance {
        master: pair.master,
        child,
        writer: Some(writer),
        output_buffer: output_buffer.clone(),
        kill_flag: kill_flag.clone(),
        suppress_events: suppress_events.clone(),
    };

    {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        // Replacing an existing instance must not leak its process
        if let Some(mut old) = instances.remove(&id) {
            kill_instance(&mut old);
        }
        instances.insert(id.clone(), instance);
    }

    // Emitter thread: coalesces decoded chunks (5ms window / 64KB cap) into
    // pty-data events. A Claude TUI redraw storm produces hundreds of small
    // reads per second — one Tauri event per read floods the WebView2 IPC.
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    {
        let emitter_id = id.clone();
        let emitter_app = app.clone();
        let emitter_suppress = suppress_events.clone();
        std::thread::spawn(move || {
            const COALESCE_MS: u64 = 5;
            const BATCH_MAX_BYTES: usize = 64 * 1024;
            loop {
                let first = match rx.recv() {
                    Ok(t) => t,
                    Err(_) => break,
                };
                let mut batch = first;
                let deadline = std::time::Instant::now()
                    + std::time::Duration::from_millis(COALESCE_MS);
                while batch.len() < BATCH_MAX_BYTES {
                    let now = std::time::Instant::now();
                    if now >= deadline {
                        break;
                    }
                    match rx.recv_timeout(deadline - now) {
                        Ok(t) => batch.push_str(&t),
                        Err(_) => break,
                    }
                }
                if !emitter_suppress.load(Ordering::Relaxed) {
                    let _ = emitter_app.emit(&format!("pty-data-{}", emitter_id), &batch);
                }
            }
            // Channel closed → reader finished → signal exit
            let _ = emitter_app.emit(&format!("pty-exit-{}", emitter_id), ());
        });
    }

    // Reader thread - MUST be std::thread, NOT tokio::spawn (portable-pty uses blocking I/O)
    let reader_id = id.clone();
    let reader_buffer = output_buffer.clone();
    let reader_kill = kill_flag.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut utf8_remainder: Vec<u8> = Vec::new();

        loop {
            // Check kill flag — break on poisoned mutex too
            match reader_kill.lock() {
                Ok(killed) => {
                    if *killed {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[pty:{}] Kill flag mutex poisoned, stopping reader: {}", reader_id, e);
                    break;
                }
            }

            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let mut data = Vec::with_capacity(utf8_remainder.len() + n);
                    data.extend_from_slice(&utf8_remainder);
                    data.extend_from_slice(&buf[..n]);
                    utf8_remainder.clear();

    // Handle incomplete UTF-8 at the end. `error_len()` distinguishes
                    // a truncated multi-byte sequence at the tail (None → carry
                    // it into the next read, ≤3 bytes by construction) from a
                    // genuinely invalid byte (Some → decode lossily, no carry —
                    // carrying it would poison every subsequent chunk).
                    let text = match std::str::from_utf8(&data) {
                        Ok(s) => s.to_owned(),
                        Err(e) => match e.error_len() {
                            Some(_) => String::from_utf8_lossy(&data).into_owned(),
                            None => {
                                let valid_up_to = e.valid_up_to();
                                utf8_remainder.extend_from_slice(&data[valid_up_to..]);
                                String::from_utf8_lossy(&data[..valid_up_to]).into_owned()
                            }
                        },
                    };

                    if text.is_empty() {
                        continue;
                    }

                    // Store in output buffer
                    if let Ok(mut buffer) = reader_buffer.lock() {
                        buffer.extend_from_slice(text.as_bytes());
                        // Drain if exceeds 1MB - keep last 512KB
                        if buffer.len() > BUFFER_MAX {
                            let drain_to = buffer.len() - BUFFER_KEEP;
                            buffer.drain(..drain_to);
                        }
                    }

                    // Hand off to the coalescing emitter thread
                    if tx.send(text).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }

        // Flush any remaining incomplete UTF-8 bytes as lossy
        if !utf8_remainder.is_empty() {
            let text = String::from_utf8_lossy(&utf8_remainder).into_owned();
            if !text.is_empty() {
                if let Ok(mut buffer) = reader_buffer.lock() {
                    buffer.extend_from_slice(text.as_bytes());
                }
                let _ = tx.send(text);
            }
        }

        // Dropping tx ends the emitter thread, which emits pty-exit
        let _ = reader_id;
    });

    Ok(())
}

#[tauri::command]
pub async fn pty_write(
    id: String,
    data: String,
    state: tauri::State<'_, PtyManager>,
) -> Result<(), String> {
    write_to_instance(&state, &id, &data)
}

/// The body of `pty_write`, callable from Rust. The panel bus uses it to type
/// a cross-panel message into a terminal panel's TUI.
pub fn write_to_instance(
    state: &tauri::State<'_, PtyManager>,
    id: &str,
    data: &str,
) -> Result<(), String> {
    let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
    let instance = instances.get_mut(id).ok_or_else(|| {
        format!(
            "that panel's terminal has not started yet — open it once so its \
Claude session spawns, then try again"
        )
    })?;
    let writer = instance
        .writer
        .as_mut()
        .ok_or_else(|| "that panel's terminal is not accepting input".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    writer.flush().map_err(|e| format!("Flush failed: {}", e))
}

#[tauri::command]
pub async fn pty_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PtyManager>,
) -> Result<(), String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    if let Some(instance) = instances.get(&id) {
        instance
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
    } else {
        return Err(format!("PTY instance '{}' not found", id));
    }
    Ok(())
}

#[tauri::command]
pub async fn pty_kill(
    id: String,
    app: AppHandle,
    state: tauri::State<'_, PtyManager>,
) -> Result<(), String> {
    {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        if let Some(mut instance) = instances.remove(&id) {
            kill_instance(&mut instance);
        }
    }
    if let Some(bus) = app.try_state::<crate::panelbus::PanelBus>() {
        bus.forget_panel(&id);
    }
    crate::panelbus::spawn_config::remove_for_panel(&id);
    Ok(())
}

#[tauri::command]
pub async fn pty_get_buffer(
    id: String,
    state: tauri::State<'_, PtyManager>,
) -> Result<String, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    if let Some(instance) = instances.get(&id) {
        let buffer = instance.output_buffer.lock().map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&buffer).into_owned())
    } else {
        Err(format!("PTY instance '{}' not found", id))
    }
}

#[tauri::command]
pub async fn pty_list_instances(
    state: tauri::State<'_, PtyManager>,
) -> Result<Vec<String>, String> {
    let instances = state.instances.lock().map_err(|e| e.to_string())?;
    Ok(instances.keys().cloned().collect())
}

#[tauri::command]
pub async fn pty_query_command(
    id: String,
    command: String,
    app: AppHandle,
    state: tauri::State<'_, PtyManager>,
) -> Result<String, String> {
    // 1. Set suppress_events = true
    let (suppress, buffer_arc) = {
        let instances = state.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get(&id)
            .ok_or_else(|| format!("PTY instance '{}' not found", id))?;
        (
            instance.suppress_events.clone(),
            instance.output_buffer.clone(),
        )
    };

    suppress.store(true, Ordering::Relaxed);

    // 2. Record buffer length before command
    let start_len = {
        let buffer = buffer_arc.lock().map_err(|e| e.to_string())?;
        buffer.len()
    };

    // 3. Write command + \r to PTY
    {
        let mut instances = state.instances.lock().map_err(|e| e.to_string())?;
        if let Some(instance) = instances.get_mut(&id) {
            if let Some(ref mut writer) = instance.writer {
                let cmd_with_cr = format!("{}\r", command);
                writer
                    .write_all(cmd_with_cr.as_bytes())
                    .map_err(|e| format!("Write failed: {}", e))?;
                writer.flush().map_err(|e| format!("Flush failed: {}", e))?;
            }
        }
    }

    // 4. Poll every 200ms until stable (no new bytes for 500ms) or timeout (10s)
    let mut last_len = start_len;
    let mut stable_since = std::time::Instant::now();
    let timeout = std::time::Instant::now() + std::time::Duration::from_secs(10);

    loop {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let current_len = {
            let buffer = buffer_arc.lock().map_err(|e| e.to_string())?;
            buffer.len()
        };

        if current_len != last_len {
            last_len = current_len;
            stable_since = std::time::Instant::now();
        }

        // Stable for 500ms
        if stable_since.elapsed() >= std::time::Duration::from_millis(500) && current_len > start_len {
            break;
        }

        // Timeout
        if std::time::Instant::now() >= timeout {
            break;
        }
    }

    // 5. Set suppress_events = false
    suppress.store(false, Ordering::Relaxed);

    // 6. Extract captured output (handle buffer drain shifting offsets)
    let captured = {
        let buffer = buffer_arc.lock().map_err(|e| e.to_string())?;
        if buffer.len() > start_len {
            // Normal case: no drain occurred, extract new bytes
            String::from_utf8_lossy(&buffer[start_len..]).into_owned()
        } else if buffer.len() < start_len && !buffer.is_empty() {
            // Buffer was drained during query — offsets shifted, return full buffer content
            String::from_utf8_lossy(&buffer).into_owned()
        } else {
            String::new()
        }
    };

    // 7. Replay captured bytes as pty-data event so xterm stays in sync
    if !captured.is_empty() {
        let event_name = format!("pty-data-{}", id);
        let _ = app.emit(&event_name, &captured);
    }

    Ok(captured)
}
