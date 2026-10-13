//! Opt-in native regression, using an isolated home and a loopback-only model.
use super::*;
use crate::codex::executable;
use std::io::{Read, Write};
use std::time::{Duration, Instant};

struct PtyGuard(Box<dyn portable_pty::Child + Send + Sync>);
impl Drop for PtyGuard {
    fn drop(&mut self) {
        if let Some(pid) = self.0.process_id() {
            crate::util::proc::kill_tree(pid);
        }
        let _ = self.0.kill();
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "native CLI required; isolated CODEX_HOME, no real inference"]
async fn live_codex_empty_terminal_startup() {
    check_empty_terminal_startup(None, 120, 32).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "native CLI required; isolated CODEX_HOME, no real inference"]
async fn live_codex_paused_goal_terminal_startup() {
    check_empty_terminal_startup(Some("paused"), 120, 32).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "native CLI required; isolated CODEX_HOME, no real inference"]
async fn live_codex_paused_goal_narrow_terminal_startup() {
    check_empty_terminal_startup(Some("paused"), 38, 16).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "native CLI required; isolated CODEX_HOME, no real inference"]
async fn live_codex_blocked_goal_small_terminal_startup() {
    check_empty_terminal_startup(Some("blocked"), 44, 14).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "native CLI required; isolated CODEX_HOME, no real inference"]
async fn live_codex_paused_goal_terminal_resize() {
    check_empty_terminal_startup(Some("paused"), 8, 4).await;
}

async fn check_empty_terminal_startup(goal_status: Option<&str>, cols: u16, rows: u16) {
    let paused_goal = goal_status.is_some();
    let path =
        std::env::var("TESSERA_CODEX_TEST_EXECUTABLE").expect("Set TESSERA_CODEX_TEST_EXECUTABLE");
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".tmp")
        .join(format!("codex-startup-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    let home = root.join("codex-home");
    std::fs::create_dir_all(&cwd).unwrap();
    std::fs::create_dir_all(&home).unwrap();
    // Even an accidental turn can only contact a deliberately closed loopback
    // port. No user credentials, settings or workspaces are read or written.
    std::fs::write(
        home.join("config.toml"),
        r#"
model = "tessera-startup-fixture"
model_context_window = 128000
model_provider = "startup-fixture"
check_for_update_on_startup = false
[model_providers.startup-fixture]
name = "Startup fixture"
base_url = "http://127.0.0.1:9/v1"
wire_api = "responses"
requires_openai_auth = false
"#,
    )
    .unwrap();
    let env = std::collections::HashMap::from([
        ("CODEX_HOME".into(), home.to_string_lossy().into_owned()),
        ("OPENAI_API_KEY".into(), String::new()),
        ("CODEX_API_KEY".into(), String::new()),
        ("OPENAI_BASE_URL".into(), "http://127.0.0.1:9/v1".into()),
    ]);
    let config: Config = serde_json::from_value(json!({
        "cwd":cwd, "model":"tessera-startup-fixture", "terminal":true,
        "sandbox":"read-only", "approvalPolicy":"on-request"
    }))
    .unwrap();
    let client = Client::spawn(
        "startup-fixture",
        executable::resolve(Some(&path)).unwrap(),
        true,
        env.clone(),
        None,
    )
    .await
    .unwrap();
    let mut params = config.thread_params(Default::default());
    params["historyMode"] = json!("legacy");
    let mut initial = client.call("thread/start", params.clone()).await.unwrap();
    let sid = initial["thread"]["id"].as_str().unwrap().to_owned();
    *client.thread.lock().unwrap() = Some(sid.clone());
    persist_empty_terminal(&client, &config, &mut initial)
        .await
        .unwrap();
    assert_eq!(initial["thread"]["id"], sid);
    assert_eq!(initial["thread"]["turns"], json!([]));

    if let Some(status) = goal_status {
        let objective = if status == "blocked" {
            "Tessera isolated startup fixture. Preserve this stopped goal while restoring its conversation. Do not send a model turn or change its state. ".repeat(5)
        } else { "Tessera isolated startup fixture".into() };
        client.call("thread/goal/set", json!({
            "threadId":sid, "objective":objective,
            "status":status, "origin":"user"
        })).await.unwrap();
    }
    let goal_before = client.call("thread/goal/get", json!({"threadId":sid})).await.unwrap();
    let quiet = super::super::quiet_goal_resume(&client, &sid).await;
    assert_eq!(quiet, paused_goal, "Production attach must arm only for stopped goals");

    // The real remote TUI resumes the pinned ID before any prompt is sent.
    let pair = portable_pty::native_pty_system()
        .openpty(portable_pty::PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new(&client.executable.program);
    command.args(&client.executable.args);
    command.args([
        "resume",
        "--remote",
        client.endpoint.as_ref().unwrap(),
        "--remote-auth-token-env",
        "TESSERA_CODEX_REMOTE_TOKEN",
        &sid,
    ]);
    command.cwd(&cwd);
    for (key, value) in &env {
        command.env(key, value);
    }
    command.env("TESSERA_CODEX_REMOTE_TOKEN", &client.token);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    for key in [
        "CODEX_THREAD_ID",
        "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
        "CLAUDECODE",
        "CLAUDE_CODE_CHILD_SESSION",
    ] {
        command.env_remove(key);
    }
    let mut child = PtyGuard(pair.slave.spawn_command(command).unwrap());
    drop(pair.slave);
    struct ObservedWriter {
        stream: Box<dyn Write + Send>,
        escapes: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }
    impl Write for ObservedWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes == b"\x1b" { self.escapes.fetch_add(1, std::sync::atomic::Ordering::SeqCst); }
            self.stream.write(bytes)
        }
        fn flush(&mut self) -> std::io::Result<()> { self.stream.flush() }
    }
    let escapes = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let writer = Box::new(ObservedWriter {
        stream: pair.master.take_writer().unwrap(), escapes: escapes.clone(),
    });
    let input = std::sync::Arc::new(if quiet { crate::pty::TerminalInput::with_quiet_goal_resume(writer, cols, rows) }
        else { crate::pty::TerminalInput::new(writer) });
    let mut reader = pair.master.try_clone_reader().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = [0u8; 16384];
        while let Ok(n) = reader.read(&mut bytes) {
            if n == 0 || tx.send(bytes[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut wire = String::new();
    let mut dismissed_at = None;
    let mut resizes = Vec::new();
    while Instant::now() < deadline {
        if cols == 8 && resizes.is_empty() && deadline.saturating_duration_since(Instant::now()) < Duration::from_secs(28) {
            resizes.push(json!({"offset":wire.encode_utf16().count(),"cols":80,"rows":24}));
            input.resize_prompt(80, 24);
            pair.master.resize(portable_pty::PtySize { rows:24, cols:80, pixel_width:0, pixel_height:0 }).unwrap();
        }
        if let Ok(bytes) = rx.recv_timeout(Duration::from_millis(100)) {
            let text = String::from_utf8_lossy(&bytes);
            wire.push_str(&text);
            if text.contains("\x1b[6n") {
                input.write("\x1b[1;1R").unwrap();
            }
            if text.contains("\x1b[c") {
                input.write("\x1b[?1;2c").unwrap();
            }
            if text.contains("\x1b]11;?") {
                input.write("\x1b]11;rgb:1111/1111/1b1b\x1b\\").unwrap();
            }
            input.observe_output(&text);
            if escapes.load(std::sync::atomic::Ordering::SeqCst) > 0 && dismissed_at.is_none() {
                dismissed_at = Some(Instant::now());
            }
            if !paused_goal && wire.contains("show current session configuration")
                && wire.contains("tessera-startup-fixture")
            {
                break;
            }
        }
        if dismissed_at.is_some_and(|at| at.elapsed() > Duration::from_secs(2)) { break; }
        if child.0.try_wait().unwrap().is_some() {
            break;
        }
    }
    std::fs::write(root.join("terminal-output.txt"), &wire).unwrap();
    std::fs::write(root.join("terminal-size.json"), json!({"cols":cols,"rows":rows,"resizes":resizes}).to_string()).unwrap();
    assert!(
        wire.contains("Ask Codex"),
        "Native TUI was not ready; see {}",
        root.display()
    );
    if paused_goal {
        assert_eq!(escapes.load(std::sync::atomic::Ordering::SeqCst), 1, "Startup dialog was not dismissed; see {}", root.display());
        assert_eq!(client.call("thread/goal/get", json!({"threadId":sid})).await.unwrap(), goal_before);
    }
    let empty = client
        .call("thread/read", json!({"threadId":sid,"includeTurns":true}))
        .await
        .unwrap();
    assert_eq!(
        empty["thread"]["turns"],
        json!([]),
        "Startup must not send a hidden turn"
    );
    assert_eq!(empty["thread"]["id"], sid);
    drop(child);
    drop(input);
    drop(pair.master);
    client.stop();

    // Reopening Tessera must find the same empty rollout, not make a new one.
    let resumed = Client::spawn(
        "startup-reopen",
        executable::resolve(Some(&path)).unwrap(),
        true,
        env,
        None,
    )
    .await
    .unwrap();
    params.as_object_mut().unwrap().remove("historyMode");
    params["threadId"] = json!(sid);
    let restored = resumed.call("thread/resume", params).await.unwrap();
    assert_eq!(restored["thread"]["id"], sid);
    assert_eq!(restored["thread"]["turns"], json!([]));
    assert_eq!(restored["approvalPolicy"], "on-request");
    assert_eq!(restored["sandbox"]["type"], "readOnly");
    assert_eq!(resumed.call("thread/goal/get", json!({"threadId":sid})).await.unwrap(), goal_before);
    resumed.stop();
    println!(
        "PASS native empty TUI, zero hidden turns, exact-ID reopen and read-only policy: {}",
        root.display()
    );
}
