//! Use Claude's supported agent commands, never its private daemon files or a
//! machine-wide process kill. Ownership starts with an exact full session UUID.
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone)]
pub struct Client {
    exe: PathBuf,
    cwd: PathBuf,
    env: BTreeMap<String, String>,
    agents_supported: Arc<AtomicBool>,
    // A worker can switch conversation with /clear or /resume. Its short job
    // ID and start time still identify the same worker that we attached to.
    attached_jobs: Arc<Mutex<HashMap<String, u64>>>,
}

#[derive(Clone)]
pub struct Owner {
    pub client: Client,
    pub ids: Arc<Mutex<HashSet<String>>>,
}

#[derive(Debug, PartialEq)]
struct BackgroundSession {
    id: String,
    session_id: String,
    started_at: Option<u64>,
}

fn parse_sessions(bytes: &[u8]) -> Result<Vec<BackgroundSession>, String> {
    let records: Vec<serde_json::Value> = serde_json::from_slice(bytes)
        .map_err(|_| "Claude returned an unsupported agent list".to_string())?;
    Ok(records
        .into_iter()
        .filter_map(|record| {
            if record["kind"] != "background" || record["state"] == "stopped" {
                return None;
            }
            let session_id = uuid::Uuid::parse_str(record["sessionId"].as_str()?)
                .ok()?
                .to_string();
            let id = record["id"].as_str()?;
            // Short worker IDs and conversation UUIDs are separate API fields.
            // Reject command-like values, names, and partial worker IDs.
            if id.len() != 8 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            Some(BackgroundSession {
                id: id.to_ascii_lowercase(),
                session_id,
                started_at: record["startedAt"].as_u64(),
            })
        })
        .collect())
}

impl Client {
    pub fn new(exe: PathBuf, cwd: PathBuf, env: &Option<HashMap<String, String>>) -> Self {
        Self {
            exe,
            cwd,
            env: env.clone().unwrap_or_default().into_iter().collect(),
            agents_supported: Default::default(),
            attached_jobs: Default::default(),
        }
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(&self.exe);
        cmd.args(args).current_dir(&self.cwd).envs(&self.env);
        for key in [
            "CLAUDECODE",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_CODE_CHILD_SESSION",
            "CLAUDE_EXE",
        ] {
            cmd.env_remove(key);
        }
        cmd.env("DISABLE_AUTOUPDATER", "1").env("NO_COLOR", "1");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW, including npm shims
        }
        cmd
    }

    fn sessions(&self) -> Result<Vec<BackgroundSession>, String> {
        let sessions = parse_sessions(&run(
            self.command(&["agents", "--json"]),
            Duration::from_secs(4),
        )?)?;
        self.agents_supported.store(true, Ordering::Release);
        Ok(sessions)
    }

    pub fn attachment(&self, session_id: &str) -> Option<String> {
        let id = uuid::Uuid::parse_str(session_id).ok()?.to_string();
        // Older CLIs have no agents command. Keep their existing --resume path.
        let session = self
            .sessions()
            .ok()?
            .into_iter()
            .find(|s| s.session_id == id)?;
        if let Some(started_at) = session.started_at {
            self.attached_jobs
                .lock()
                .ok()?
                .insert(session.id.clone(), started_at);
        }
        Some(session.id)
    }

    fn owns(&self, ids: &HashSet<String>, session: &BackgroundSession) -> bool {
        ids.contains(&session.session_id)
            || session.started_at.is_some_and(|started_at| {
                self.attached_jobs
                    .lock()
                    .is_ok_and(|jobs| jobs.get(&session.id) == Some(&started_at))
            })
    }

    fn stop(&self, id: &str) -> Result<(), String> {
        run(self.command(&["stop", id]), Duration::from_secs(5)).map(|_| ())
    }
}

fn run(mut command: Command, timeout: Duration) -> Result<Vec<u8>, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Cannot query Claude background sessions: {e}"))?;
    let mut pipe = child
        .stdout
        .take()
        .ok_or("Claude output pipe unavailable")?;
    // Drain concurrently so a large agent list cannot fill the pipe and hang.
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut result = Vec::new();
        let mut chunk = [0u8; 8192];
        let mut oversized = false;
        while let Ok(n) = pipe.read(&mut chunk) {
            if n == 0 {
                break;
            }
            if result.len() + n <= 2 * 1024 * 1024 {
                result.extend_from_slice(&chunk[..n]);
            } else {
                oversized = true;
            }
        }
        let _ = tx.send(if oversized {
            Err("Claude agent response is too large".to_string())
        } else {
            Ok(result)
        });
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!("Claude background command exited with {status}"));
                }
                return rx
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .map_err(|_| "Claude output pipe did not close before the timeout")?;
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                crate::util::proc::kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                return Err("Claude background command timed out".into());
            }
        }
    }
}

/// Query once per executable/config environment, even when many panels share
/// it. Concurrent groups and stop requests keep shutdown bounded and responsive.
pub fn stop_owned(owners: Vec<Owner>) -> Result<(), String> {
    let mut groups: HashMap<(PathBuf, BTreeMap<String, String>), (Client, HashSet<String>)> =
        HashMap::new();
    for owner in owners {
        let ids = owner.ids.lock().map_err(|e| e.to_string())?.clone();
        if ids.is_empty() {
            continue;
        }
        let supported = owner.client.agents_supported.load(Ordering::Acquire);
        let attached_jobs = owner
            .client
            .attached_jobs
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        let group = groups
            .entry((owner.client.exe.clone(), owner.client.env.clone()))
            .or_insert_with(|| (owner.client, HashSet::new()));
        if supported {
            group.0.agents_supported.store(true, Ordering::Release);
        }
        group
            .0
            .attached_jobs
            .lock()
            .map_err(|e| e.to_string())?
            .extend(attached_jobs);
        group.1.extend(ids);
    }
    let errors = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for (_, (client, ids)) in groups {
            let errors = &errors;
            scope.spawn(move || {
                // An old CLI does not host daemon sessions, so an unsupported
                // agents command must not prevent normal PTY cleanup.
                let sessions = match client.sessions() {
                    Ok(sessions) => sessions,
                    Err(e) => {
                        if client.agents_supported.load(Ordering::Acquire) {
                            errors.lock().unwrap().push(e);
                        }
                        return;
                    }
                };
                std::thread::scope(|scope| {
                    for session in sessions.into_iter().filter(|s| client.owns(&ids, s)) {
                        let client = &client;
                        scope.spawn(move || {
                            if let Err(e) = client.stop(&session.id) {
                                errors.lock().unwrap().push(format!(
                                    "Could not stop Claude session {}: {e}",
                                    session.id
                                ));
                            }
                        });
                    }
                });
            });
        }
    });
    let errors = errors.into_inner().unwrap();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_background_session_identities_can_be_attached_or_stopped() {
        let records = serde_json::json!([
            {"kind":"background","id":"b0b7f16f","sessionId":"b0b7f16f-c102-41a6-ae32-ebd05248a9d9","state":"blocked"},
            {"kind":"interactive","id":"b0b7f16f","sessionId":"b0b7f16f-c102-41a6-ae32-ebd05248a9d9"},
            {"kind":"background","id":"b0b7f16f","sessionId":"b0b7f16f-c102-41a6-ae32-ebd05248a9d9","state":"stopped"},
            {"kind":"background","id":"--all","sessionId":"b0b7f16f-c102-41a6-ae32-ebd05248a9d9"},
            {"kind":"background","id":"b0b7","sessionId":"b0b7f16f-c102-41a6-ae32-ebd05248a9d9"},
            {"kind":"background","id":"b0b7f16f","sessionId":"../invalid"}
        ]);
        let sessions = parse_sessions(records.to_string().as_bytes()).unwrap();
        assert_eq!(
            sessions,
            vec![BackgroundSession {
                id: "b0b7f16f".into(),
                session_id: "b0b7f16f-c102-41a6-ae32-ebd05248a9d9".into(),
                started_at: None,
            }]
        );
        assert!(parse_sessions(b"Claude agents is unavailable").is_err());
        assert!(parse_sessions(b"{}").is_err());
    }

    #[test]
    fn attached_job_survives_conversation_switch_but_a_reused_id_is_not_owned() {
        let client = Client::new("not-executed".into(), ".".into(), &None);
        client
            .attached_jobs
            .lock()
            .unwrap()
            .insert("b0b7f16f".into(), 123);
        let sessions = parse_sessions(br#"[{"kind":"background","id":"b0b7f16f","sessionId":"aaaaaaaa-c102-41a6-ae32-ebd05248a9d9","startedAt":123}]"#).unwrap();
        let mut session = sessions.into_iter().next().unwrap();
        assert!(client.owns(&HashSet::new(), &session));
        session.started_at = Some(456);
        assert!(!client.owns(&HashSet::new(), &session));
        session.started_at = None;
        assert!(!client.owns(&HashSet::new(), &session));
    }

    #[test]
    fn helper_commands_keep_config_isolation_and_strip_nested_session_markers() {
        let client = Client::new(
            "claude".into(),
            ".".into(),
            &Some(HashMap::from([
                ("CLAUDE_CONFIG_DIR".into(), "routed-profile".into()),
                ("CLAUDECODE".into(), "1".into()),
            ])),
        );
        let cmd = client.command(&["agents", "--json"]);
        let env: HashMap<_, _> = cmd
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect();
        assert_eq!(env["CLAUDE_CONFIG_DIR"].as_deref(), Some("routed-profile"));
        assert_eq!(env["CLAUDECODE"], None);
        assert_eq!(env["DISABLE_AUTOUPDATER"].as_deref(), Some("1"));
    }

    #[cfg(windows)]
    #[test]
    fn helper_timeout_is_bounded_without_touching_any_real_claude_process() {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 30",
        ])
        .creation_flags(0x0800_0000);
        let start = Instant::now();
        assert!(run(cmd, Duration::from_millis(150))
            .unwrap_err()
            .contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[cfg(windows)]
    #[test]
    fn fake_cli_attaches_exact_session_and_stops_only_owned_workers_once() {
        let dir =
            std::env::temp_dir().join(format!("tessera-fake-claude-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("claude.cmd");
        let log = dir.join("calls.log");
        let mut records = serde_json::json!([
            {"kind":"background","id":"11111111","sessionId":"11111111-1111-4111-8111-111111111111","startedAt":123},
            {"kind":"background","id":"22222222","sessionId":"22222222-2222-4222-8222-222222222222"},
            {"kind":"interactive","sessionId":"33333333-3333-4333-8333-333333333333"},
            {"kind":"background","id":"44444444","sessionId":"44444444-4444-4444-8444-444444444444"}
        ]);
        std::fs::write(&exe, format!("@echo off\r\necho %*>>\"%TESSERA_FAKE_LOG%\"\r\nif \"%1\"==\"agents\" echo {records}\r\nexit /b 0\r\n")).unwrap();
        let env = Some(HashMap::from([(
            "TESSERA_FAKE_LOG".into(),
            log.to_string_lossy().into_owned(),
        )]));
        let client = Client::new(exe, dir.clone(), &env);
        assert_eq!(
            client.attachment("11111111-1111-4111-8111-111111111111"),
            Some("11111111".into())
        );
        assert_eq!(
            client.attachment("11111111-1111-4111-8111-111111111112"),
            None
        );
        // The attached worker switches to a different conversation. Its old
        // hook settings need not belong to this app run, so job identity matters.
        records[0]["sessionId"] = "55555555-5555-4555-8555-555555555555".into();
        std::fs::write(exe_path(&dir), format!("@echo off\r\necho %*>>\"%TESSERA_FAKE_LOG%\"\r\nif \"%1\"==\"agents\" echo {records}\r\nexit /b 0\r\n")).unwrap();
        std::fs::write(&log, "").unwrap();
        let ids = Arc::new(Mutex::new(HashSet::from([
            "11111111-1111-4111-8111-111111111111".into(),
            "22222222-2222-4222-8222-222222222222".into(),
            "33333333-3333-4333-8333-333333333333".into(),
        ])));
        let owner = Owner { client, ids };
        stop_owned(vec![owner.clone(), owner]).unwrap();
        let calls = std::fs::read_to_string(&log).unwrap();
        assert_eq!(calls.lines().filter(|s| *s == "agents --json").count(), 1);
        assert_eq!(calls.lines().filter(|s| *s == "stop 11111111").count(), 1);
        assert_eq!(calls.lines().filter(|s| *s == "stop 22222222").count(), 1);
        assert!(!calls.contains("33333333") && !calls.contains("44444444"));
        std::fs::remove_file(exe_path(&dir)).unwrap();
        std::fs::remove_file(log).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[cfg(windows)]
    fn exe_path(dir: &std::path::Path) -> PathBuf {
        dir.join("claude.cmd")
    }
}
