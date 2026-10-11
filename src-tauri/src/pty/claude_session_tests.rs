//! Real Claude TUI regression: local commands only, isolated config, closed model endpoint.
use super::*;
use http_body_util::{BodyExt, Full};
use hyper::{body::Bytes, server::conn::http1, service::service_fn, Response};
use hyper_util::rt::TokioIo;
use std::{
    io::{Read, Write},
    time::{Duration, Instant},
};

struct ChildGuard(Box<dyn portable_pty::Child + Send + Sync>);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(pid) = self.0.process_id() {
            crate::util::proc::kill_tree(pid);
        }
        let _ = self.0.kill();
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "native Claude CLI required; isolated config, no model calls"]
async fn live_claude_tracks_resume_and_clear() {
    let executable = std::env::var("TESSERA_CLAUDE_TEST_EXECUTABLE")
        .expect("Set TESSERA_CLAUDE_TEST_EXECUTABLE");
    let root =
        std::env::temp_dir().join(format!("tessera-claude-session-{}", uuid::Uuid::new_v4()));
    let cwd = root.join("project");
    let config_dir = root.join("claude-home");
    std::fs::create_dir_all(&cwd).unwrap();
    std::fs::create_dir_all(&config_dir).unwrap();
    let trusted = json!({"hasTrustDialogAccepted":true, "hasCompletedProjectOnboarding":true, "allowedTools":[]});
    std::fs::write(config_dir.join(".claude.json"), json!({
        "hasCompletedOnboarding":true, "theme":"dark", "autoUpdates":false,
        "projects":{cwd.to_string_lossy().as_ref():trusted, cwd.to_string_lossy().replace('\\',"/"):trusted}
    }).to_string()).unwrap();
    std::fs::write(config_dir.join("settings.json"), "{}").unwrap();

    // A synthetic existing conversation lets /resume exercise the real CLI
    // without creating a model turn or reading the user's transcripts.
    let target = uuid::Uuid::new_v4().to_string();
    let project = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let transcripts = config_dir.join("projects").join(project);
    std::fs::create_dir_all(&transcripts).unwrap();
    let user_id = uuid::Uuid::new_v4().to_string();
    let rows = [
        json!({"type":"user", "uuid":user_id, "parentUuid":null, "sessionId":target,
            "cwd":cwd, "timestamp":"2026-10-11T10:00:00.000Z", "version":"2.1.296",
            "message":{"role":"user", "content":"Tessera local session tracking fixture"}}),
        json!({"type":"assistant", "uuid":uuid::Uuid::new_v4().to_string(), "parentUuid":user_id,
            "sessionId":target, "cwd":cwd, "timestamp":"2026-10-11T10:00:01.000Z", "version":"2.1.296",
            "message":{"role":"assistant", "id":"msg_fixture", "type":"message", "model":"claude-sonnet-4-5",
                "content":[{"type":"text", "text":"Fixture restored."}], "stop_reason":"end_turn",
                "usage":{"input_tokens":0, "output_tokens":0}}}),
    ];
    std::fs::write(
        transcripts.join(format!("{target}.jsonl")),
        rows.iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            + "\n",
    )
    .unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let sessions = ClaudeSessions::default();
    let panel = uuid::Uuid::new_v4().to_string();
    let registration = sessions
        .prepare_in(&panel, port, root.join("hooks"))
        .unwrap();
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let serve = tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let sessions = sessions.clone();
            let panel = panel.clone();
            let events_tx = events_tx.clone();
            tokio::spawn(async move {
                let handler = service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                    let sessions = sessions.clone();
                    let panel = panel.clone();
                    let tx = events_tx.clone();
                    async move {
                        let token = req
                            .headers()
                            .get("authorization")
                            .and_then(|h| h.to_str().ok())
                            .and_then(|h| h.strip_prefix("Bearer "))
                            .unwrap_or("")
                            .to_owned();
                        let body = req.into_body().collect().await.unwrap().to_bytes();
                        let event: Value = serde_json::from_slice(&body).unwrap();
                        if let Some(change) = sessions.accept(&panel, &token, &event) {
                            let _ = tx.send((change.session_id, event["source"].clone()));
                        }
                        Ok::<_, std::convert::Infallible>(Response::new(Full::new(
                            Bytes::from_static(b"{}"),
                        )))
                    }
                });
                let _ = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), handler)
                    .await;
            });
        }
    });
    let initial = uuid::Uuid::new_v4().to_string();
    let pair = portable_pty::native_pty_system()
        .openpty(portable_pty::PtySize {
            rows: 40,
            cols: 140,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new(executable);
    command.args([
        "--session-id",
        &initial,
        "--settings",
        registration.settings_path.to_str().unwrap(),
        "--setting-sources",
        "user",
    ]);
    command.args(["--debug-file", root.join("debug.log").to_str().unwrap()]);
    command.cwd(&cwd);
    command.env("CLAUDE_CONFIG_DIR", &config_dir);
    command.env("ANTHROPIC_BASE_URL", "http://127.0.0.1:9");
    command.env("ANTHROPIC_AUTH_TOKEN", "tessera-isolated-fixture");
    command.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    command.env("TERM", "xterm-256color");
    for key in [
        "CLAUDECODE",
        "CLAUDE_CODE_CHILD_SESSION",
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_OAUTH_TOKEN",
    ] {
        command.env_remove(key);
    }
    let child = ChildGuard(pair.slave.spawn_command(command).unwrap());
    drop(pair.slave);
    let mut writer = pair.master.take_writer().unwrap();
    let mut reader = pair.master.try_clone_reader().unwrap();
    let (output_tx, output_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = [0; 16384];
        while let Ok(n) = reader.read(&mut bytes) {
            if n == 0 || output_tx.send(bytes[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(35);
    let mut wire = String::new();
    let mut changes = vec![];
    let mut next_command = None;
    while Instant::now() < deadline && changes.len() < 3 {
        if let Ok(bytes) = output_rx.recv_timeout(Duration::from_millis(50)) {
            let text = String::from_utf8_lossy(&bytes);
            wire.push_str(&text);
            if text.contains("\x1b[6n") {
                writer.write_all(b"\x1b[1;1R").unwrap();
            }
            if text.contains("\x1b[c") {
                writer.write_all(b"\x1b[?1;2c").unwrap();
            }
            if text.contains("\x1b]11;?") {
                writer
                    .write_all(b"\x1b]11;rgb:1111/1111/1b1b\x1b\\")
                    .unwrap();
            }
            writer.flush().unwrap();
        }
        while let Ok(event) = events_rx.try_recv() {
            changes.push(event);
            next_command = match changes.len() {
                1 => Some((Instant::now(), format!("/resume {target}\r"))),
                2 => Some((Instant::now(), "/clear\r".to_owned())),
                _ => None,
            };
        }
        if next_command
            .as_ref()
            .is_some_and(|(at, _)| at.elapsed() > Duration::from_secs(2))
        {
            let (_, text) = next_command.take().unwrap();
            writer.write_all(text.as_bytes()).unwrap();
            writer.flush().unwrap();
        }
    }
    std::fs::write(root.join("terminal-output.txt"), wire).unwrap();
    drop(child);
    drop(writer);
    drop(pair.master);
    serve.abort();
    drop(registration);
    assert_eq!(
        changes.len(),
        3,
        "Missing native hooks; see {}. Received: {changes:?}",
        root.display()
    );
    assert_eq!(changes[0], (initial.clone(), json!("startup")));
    assert_eq!(changes[1], (target.clone(), json!("resume")));
    assert_eq!(changes[2].1, "clear");
    assert_ne!(changes[2].0, initial);
    assert_ne!(changes[2].0, target);
    println!(
        "PASS native Claude startup, /resume and /clear IDs: {}",
        root.display()
    );
}
