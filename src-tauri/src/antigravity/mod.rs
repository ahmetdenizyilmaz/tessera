//! Google Antigravity (`agy`) panels.
//!
//! Chat panels own one `agy --input-format stream-json --output-format stream-json`
//! process per panel and resume it with `--conversation <id>`. Terminal panels run
//! the native TUI on a conversation pinned through the same interface. Everything
//! here follows the installed CLI's documented flags; nothing reads its private
//! conversation database.
pub mod executable;
pub mod state;

use executable::Executable;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use state::{Effect, Finished, Saved, Transcript};
use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const INIT_TIMEOUT: Duration = Duration::from_secs(90);
const BUSY: &str = "Antigravity is still working on the previous message. Wait for it to finish or stop the turn first.";
const SIGN_IN: &str = "Antigravity is not signed in. Open an Antigravity terminal panel (or run agy in any terminal), complete the browser sign-in, then retry.";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub cwd: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    /// review | accept-edits | plan | skip
    #[serde(default = "default_permission")]
    pub permission: String,
    #[serde(default)]
    pub sandbox: bool,
    #[serde(default)]
    pub executable_path: String,
    /// Names this panel's transcript file; independent of the CLI's conversation ID.
    pub data_id: String,
}
fn default_permission() -> String {
    "review".into()
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !std::path::Path::new(&self.cwd).is_dir() {
            return Err("Choose an existing project folder for Antigravity.".into());
        }
        if !["review", "accept-edits", "plan", "skip"].contains(&self.permission.as_str()) {
            return Err("Invalid Antigravity permission mode.".into());
        }
        if !["", "low", "medium", "high", "xhigh", "max"].contains(&self.effort.as_str()) {
            return Err("Invalid Antigravity reasoning effort.".into());
        }
        // Passed as one argument without a shell; still never let it read as a flag.
        if self.model.starts_with('-') || self.model.chars().any(char::is_control) {
            return Err("Invalid Antigravity model ID.".into());
        }
        if !safe_id(&self.data_id) {
            return Err("Invalid Antigravity panel storage ID.".into());
        }
        Ok(())
    }
    /// Flags shared by the headless stream and the native terminal.
    fn flags(&self, conversation: Option<&str>) -> Vec<String> {
        let mut args = vec![];
        if !self.model.is_empty() {
            args.extend(["--model".into(), self.model.clone()]);
        }
        if !self.effort.is_empty() {
            args.extend(["--effort".into(), self.effort.clone()]);
        }
        match self.permission.as_str() {
            "accept-edits" | "plan" => args.extend(["--mode".into(), self.permission.clone()]),
            "skip" => args.push("--dangerously-skip-permissions".into()),
            _ => {}
        }
        if self.sandbox {
            args.push("--sandbox".into());
        }
        if let Some(id) = conversation {
            args.extend(["--conversation".into(), id.into()]);
        }
        args
    }
    fn stream_args(&self, conversation: Option<&str>) -> Vec<String> {
        let mut args: Vec<String> = ["--input-format", "stream-json", "--output-format", "stream-json"]
            .map(String::from)
            .into();
        args.extend(self.flags(conversation));
        args
    }
}

/// Which recovery action the panel should offer for an error.
fn recovery_for(text: &str) -> &'static str {
    let lower = text.to_lowercase();
    if ["not logged in", "not signed in", "log in", "login", "sign in", "unauthenticated", "authenticat", "credential"]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        "login"
    } else if lower.contains("was not found. install") || lower.contains("executable path is invalid") || lower.contains("cannot start antigravity") {
        "executable"
    } else {
        "retry"
    }
}

fn now() -> i64 {
    crate::activity::model::now()
}

type Sink = Arc<dyn Fn(Value) + Send + Sync>;

struct Proc {
    child: Child,
    stdin: Option<ChildStdin>,
    epoch: u64,
    init: bool,
    /// The CLI opened this conversation instead of the one requested.
    mismatch: Option<String>,
    startup_error: Option<String>,
    stderr: VecDeque<String>,
    /// Tessera ended this process on purpose (close, restart, pin).
    expected_exit: bool,
}

struct Inner {
    config: Config,
    executable: Executable,
    conversation_id: Option<String>,
    transcript: Transcript,
    proc: Option<Proc>,
    epoch: u64,
    startup_failure: Option<String>,
    error: Option<String>,
    recovery: Option<&'static str>,
    init: Value,
}

pub struct Session {
    inner: Mutex<Inner>,
    /// One send/start at a time per panel.
    gate: tokio::sync::Mutex<()>,
    revision: AtomicU64,
    generation: String,
    store: PathBuf,
    sink: Sink,
}

impl Session {
    pub fn open(config: Config, executable: Executable, conversation_id: Option<String>, store: PathBuf, sink: Sink) -> Arc<Self> {
        let saved: Saved = std::fs::read(&store)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        // The workspace's ID wins: it is what the user saved for this panel.
        let conversation_id = conversation_id.or(saved.conversation_id.clone());
        Arc::new(Self {
            inner: Mutex::new(Inner {
                config,
                executable,
                conversation_id,
                transcript: Transcript::restore(saved),
                proc: None,
                epoch: 0,
                startup_failure: None,
                error: None,
                recovery: None,
                init: Value::Null,
            }),
            gate: tokio::sync::Mutex::new(()),
            revision: AtomicU64::new(1),
            generation: uuid::Uuid::new_v4().to_string(),
            store,
            sink,
        })
    }
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn bump(&self) {
        self.revision.fetch_add(1, Ordering::AcqRel);
    }
    fn revision(&self) -> String {
        format!("{}:{}", self.generation, self.revision.load(Ordering::Acquire))
    }
    fn persist(&self, inner: &mut Inner) {
        let saved = inner.transcript.save(inner.conversation_id.clone());
        let result = (|| {
            if let Some(dir) = self.store.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let temporary = self.store.with_extension("json.tmp");
            std::fs::write(&temporary, serde_json::to_vec(&saved).unwrap_or_default())?;
            std::fs::rename(&temporary, &self.store)
        })();
        if let Err(error) = result {
            inner.error = Some(format!("Cannot save this panel's Antigravity transcript: {error}"));
        }
    }
    fn fail(&self, inner: &mut Inner, message: &str) {
        inner.error = Some(message.into());
        inner.recovery = Some(recovery_for(message));
    }
    fn report(&self, conversation: Option<&String>, finished: &Finished) {
        let Some(session) = conversation.filter(|_| finished.announced) else {
            return;
        };
        (self.sink)(json!({"type":"turn_finished","session":session,"turn":finished.turn,"status":finished.status,
            "response":finished.response,
            "cumulative":finished.cumulative.as_ref().map(|u| u.wire()),"steps":finished.steps.as_ref().map(|u| u.wire())}));
    }

    pub fn snapshot(&self) -> Value {
        let inner = self.lock();
        json!({
            "generation": self.generation,
            "revision": self.revision(),
            "configured": true,
            "conversationId": inner.conversation_id,
            "processAlive": inner.proc.as_ref().is_some_and(|p| p.init),
            "busy": inner.transcript.busy(),
            "items": inner.transcript.items,
            "error": inner.error,
            "recovery": inner.recovery,
            "model": inner.init["model"].as_str().unwrap_or(&inner.config.model),
            "permissionMode": inner.init["permissionMode"],
            "tools": inner.init["tools"],
            "usage": inner.transcript.cumulative,
        })
    }

    fn spawn(self: &Arc<Self>) -> Result<(), String> {
        let mut inner = self.lock();
        let mut command = inner.executable.command();
        command
            .args(inner.config.stream_args(inner.conversation_id.as_deref()))
            .current_dir(&inner.config.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|e| {
            format!("Cannot start Antigravity ({}): {e}", inner.executable.program.display())
        })?;
        let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
        inner.epoch += 1;
        let epoch = inner.epoch;
        inner.startup_failure = None;
        inner.transcript.process_started();
        inner.proc = Some(Proc {
            stdin: child.stdin.take(),
            child,
            epoch,
            init: false,
            mismatch: None,
            startup_error: None,
            stderr: VecDeque::new(),
            expected_exit: false,
        });
        drop(inner);
        let weak = Arc::downgrade(self);
        if let Some(stderr) = stderr {
            let weak = weak.clone();
            std::thread::spawn(move || read_lines(stderr, |line| {
                if let Some(session) = weak.upgrade() {
                    session.on_stderr(epoch, line);
                }
            }));
        }
        std::thread::spawn(move || {
            if let Some(stdout) = stdout {
                read_lines(stdout, |line| {
                    if let Some(session) = weak.upgrade() {
                        session.on_stdout(epoch, line);
                    }
                });
            }
            if let Some(session) = weak.upgrade() {
                session.on_exit(epoch);
            }
        });
        Ok(())
    }

    fn on_stderr(&self, epoch: u64, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let mut guard = self.lock();
        let inner = &mut *guard;
        let Some(proc) = inner.proc.as_mut().filter(|p| p.epoch == epoch) else {
            return;
        };
        if proc.stderr.len() >= 12 {
            proc.stderr.pop_front();
        }
        proc.stderr.push_back(line.chars().take(600).collect());
        inner.transcript.stderr(line, now());
        drop(guard);
        self.bump();
    }

    fn on_stdout(&self, epoch: u64, line: &str) {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let mut emit = vec![];
        let mut finished = None;
        let mut guard = self.lock();
        let inner = &mut *guard;
        let Some(proc) = inner.proc.as_mut().filter(|p| p.epoch == epoch) else {
            return;
        };
        match event["event"].as_str() {
            Some("init") => {
                let opened = event["conversation_id"].as_str().unwrap_or("").to_string();
                proc.init = true;
                match &inner.conversation_id {
                    // `agy --conversation <unknown>` only warns and starts another
                    // conversation. Never adopt that silently.
                    Some(expected) if *expected != opened => proc.mismatch = Some(opened),
                    Some(_) => {}
                    None => {
                        emit.push(json!({"type":"session","session":opened,"fresh":true}));
                        inner.conversation_id = Some(opened);
                    }
                }
                inner.init = json!({"model":event["init"]["model"],"permissionMode":event["init"]["permission_mode"],
                    "tools":event["init"]["tools"].as_array().map(Vec::len)});
            }
            Some("step_update") if proc.mismatch.is_none() => {
                let conversation = inner.conversation_id.clone().unwrap_or_default();
                let turn = inner.transcript.turn.as_ref().map(|t| t.id.clone());
                for effect in inner.transcript.step(&conversation, &event["step_update"], now()) {
                    emit.push(match effect {
                        Effect::Tool { name, active } => json!({"type":"tool","session":conversation,"turn":turn,"tool":name,"active":active}),
                        Effect::Response { step, text } => json!({"type":"response","session":conversation,"turn":turn,"step":step,"text":text}),
                    });
                }
            }
            Some("result") if !proc.init => {
                // Startup failures (unknown model, missing sign-in) arrive as a result with no init.
                proc.startup_error = event["result"]["error"].as_str().map(String::from);
            }
            Some("result") if proc.mismatch.is_none() => {
                finished = inner.transcript.result(&event["result"], now());
                if let Some(done) = finished.as_ref().filter(|f| f.status == "failed" && !f.error.is_empty()) {
                    let message = done.error.clone();
                    self.fail(inner, &message);
                }
                self.persist(inner);
            }
            _ => return,
        }
        let conversation = inner.conversation_id.clone();
        drop(guard);
        // Activity treats a turn as running until its end is reported, so only announced turns emit.
        for event in emit {
            if event["type"] == "session" || !event["turn"].is_null() {
                (self.sink)(event);
            }
        }
        if let Some(finished) = finished {
            self.report(conversation.as_ref(), &finished);
        }
        self.bump();
    }

    fn on_exit(&self, epoch: u64) {
        // One critical section: a waiter that sees the process gone must also see why.
        let mut guard = self.lock();
        let inner = &mut *guard;
        if !inner.proc.as_ref().is_some_and(|p| p.epoch == epoch) {
            return;
        }
        let Some(mut proc) = inner.proc.take() else { return };
        proc.stdin.take();
        // stdout is closed, so the process is exiting. Reap it (bounded) so the PID
        // cannot linger, and never hold the lock on a process that refuses to end.
        let deadline = Instant::now() + Duration::from_secs(2);
        let code = loop {
            match proc.child.try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
                _ => {
                    crate::util::proc::kill_tree(proc.child.id());
                    let _ = proc.child.kill();
                    break proc.child.wait().ok().and_then(|status| status.code());
                }
            }
        };
        let detail = proc
            .startup_error
            .clone()
            .or_else(|| (!proc.stderr.is_empty()).then(|| proc.stderr.iter().cloned().collect::<Vec<_>>().join("\n")));
        let exit = code.map(|c| format!(" (exit code {c})")).unwrap_or_default();
        let cancelled = inner.transcript.turn.as_ref().is_some_and(|t| t.cancelled);
        let message = if cancelled {
            "Stopped. agy's headless mode has no in-band cancel, so Tessera ended its process; this conversation resumes with your next message.".to_string()
        } else if !proc.init {
            detail.clone().unwrap_or_else(|| format!("Antigravity exited during startup{exit}."))
        } else {
            format!("Antigravity exited unexpectedly{exit}.{}", detail.as_ref().map(|d| format!("\n{d}")).unwrap_or_default())
        };
        if !proc.init {
            inner.startup_failure = Some(message.clone());
        }
        // When Tessera ended the process for another reason (missing conversation,
        // startup timeout), the caller reports that reason instead.
        let finished = if cancelled || !proc.expected_exit {
            inner.transcript.abort(cancelled, &message, now())
        } else {
            None
        };
        if finished.is_some() {
            if !cancelled {
                self.fail(inner, &message);
            }
            self.persist(inner);
        } else if proc.init && !proc.expected_exit && code.is_some_and(|c| c != 0) {
            inner.transcript.note("warning", format!("The Antigravity process ended{exit}. It restarts and resumes this conversation with your next message."), now());
        }
        let conversation = inner.conversation_id.clone();
        drop(guard);
        if let Some(finished) = finished {
            self.report(conversation.as_ref(), &finished);
        }
        self.bump();
    }

    /// End the process. Its reader thread settles any active turn.
    fn stop_process(&self) {
        let pid = {
            let mut inner = self.lock();
            inner.proc.as_mut().map(|proc| {
                proc.expected_exit = true;
                proc.stdin.take();
                proc.child.id()
            })
        };
        if let Some(pid) = pid {
            crate::util::proc::kill_tree(pid);
        }
    }
    async fn wait_stopped(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if self.lock().proc.is_none() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    }

    /// A live process that reported `init` for this panel's conversation.
    async fn ensure_ready(self: &Arc<Self>) -> Result<String, String> {
        if self.lock().proc.is_none() {
            self.spawn()?;
            self.bump();
        }
        let deadline = Instant::now() + INIT_TIMEOUT;
        loop {
            let (ready, mismatch, failure, expected) = {
                let mut inner = self.lock();
                let (ready, mismatch, gone) = match inner.proc.as_ref() {
                    None => (false, false, true),
                    Some(proc) => (proc.init, proc.mismatch.is_some(), false),
                };
                let failure = gone.then(|| {
                    inner
                        .startup_failure
                        .take()
                        .unwrap_or_else(|| "Antigravity exited during startup.".into())
                });
                (ready, mismatch, failure, inner.conversation_id.clone().unwrap_or_default())
            };
            if let Some(failure) = failure {
                return Err(failure);
            }
            if mismatch {
                self.stop_process();
                return Err(format!(
                    "The saved Antigravity conversation {expected} was not found on this PC, so it was not resumed. Its history may exist only on the computer that created it. Start a new conversation in this panel to continue here."
                ));
            }
            if ready {
                return Ok(expected);
            }
            if Instant::now() >= deadline {
                self.stop_process();
                return Err("Antigravity did not start within 90 seconds. Check the CLI, your connection and sign-in, then retry.".into());
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    }

    fn abort_turn(&self, turn: &str, message: &str) {
        let mut guard = self.lock();
        let inner = &mut *guard;
        if inner.transcript.turn.as_ref().is_some_and(|t| t.id == turn) {
            let cancelled = inner.transcript.turn.as_ref().is_some_and(|t| t.cancelled);
            let finished = inner.transcript.abort(cancelled, message, now());
            if !cancelled {
                self.fail(inner, message);
                if message.contains("was not found on this PC") {
                    inner.recovery = Some("new_conversation");
                }
            }
            self.persist(inner);
            let conversation = inner.conversation_id.clone();
            drop(guard);
            if let Some(finished) = finished {
                self.report(conversation.as_ref(), &finished);
            }
        }
        self.bump();
    }

    pub async fn send(self: &Arc<Self>, text: String) -> Result<(), String> {
        let _gate = self.gate.lock().await;
        let turn = {
            let mut guard = self.lock();
            let inner = &mut *guard;
            if inner.transcript.busy() {
                return Err(BUSY.into());
            }
            inner.error = None;
            inner.recovery = None;
            let turn = inner.transcript.begin_turn(&text, now());
            self.persist(inner);
            turn
        };
        self.bump();
        let conversation = match self.ensure_ready().await {
            Ok(conversation) => conversation,
            Err(error) => {
                self.abort_turn(&turn, &error);
                return Err(error);
            }
        };
        let line = format!("{}\n", json!({"event":"user","message":{"content":text}}));
        let written = {
            let mut guard = self.lock();
            let inner = &mut *guard;
            match inner.transcript.turn.as_mut().filter(|t| t.id == turn && !t.cancelled) {
                None => Err("The message was stopped before Antigravity received it.".to_string()),
                Some(active) => {
                    active.announced = true;
                    (self.sink)(json!({"type":"turn_started","session":conversation,"turn":turn,"prompt":text}));
                    inner
                        .proc
                        .as_mut()
                        .and_then(|proc| proc.stdin.as_mut())
                        .ok_or_else(|| "Antigravity is not running.".to_string())
                        .and_then(|stdin| {
                            stdin
                                .write_all(line.as_bytes())
                                .and_then(|_| stdin.flush())
                                .map_err(|e| format!("Cannot send the message to Antigravity: {e}"))
                        })
                }
            }
        };
        if let Err(error) = &written {
            self.abort_turn(&turn, error);
        }
        written
    }

    /// agy has no in-band cancel in stream-json mode (control messages exit with
    /// code 2), so stopping ends the process and the next turn resumes by ID.
    pub fn interrupt(&self) {
        let (turn, running) = {
            let mut inner = self.lock();
            let running = inner.proc.is_some();
            let turn = inner.transcript.turn.as_mut().map(|turn| {
                turn.cancelled = true;
                turn.id.clone()
            });
            (turn, running)
        };
        if running {
            self.stop_process();
        } else if let Some(turn) = turn {
            self.abort_turn(&turn, "Stopped before Antigravity started.");
        }
    }

    /// Give a terminal panel an exact conversation ID: start the headless
    /// interface, read (or verify) the ID from `init`, and exit without a turn.
    async fn pin(self: &Arc<Self>) -> Result<String, String> {
        let conversation = self.ensure_ready().await?;
        let had_input = {
            let mut inner = self.lock();
            inner.proc.as_mut().map(|proc| {
                proc.expected_exit = true;
                // EOF on stdin is the documented graceful end of a stream session.
                proc.stdin.take().is_some()
            })
        };
        if had_input.is_some() && !self.wait_stopped(Duration::from_secs(15)).await {
            self.stop_process();
            self.wait_stopped(Duration::from_secs(5)).await;
        }
        let mut guard = self.lock();
        let inner = &mut *guard;
        self.persist(inner);
        Ok(conversation)
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(proc) = self.inner.get_mut().unwrap_or_else(|e| e.into_inner()).proc.as_mut() {
            crate::util::proc::kill_tree(proc.child.id());
            let _ = proc.child.kill();
        }
    }
}

fn read_lines(source: impl std::io::Read, mut each: impl FnMut(&str)) {
    let mut reader = BufReader::new(source);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes) {
            Ok(0) | Err(_) => return,
            Ok(_) => each(String::from_utf8_lossy(&bytes).trim_end_matches(['\r', '\n'])),
        }
    }
}

#[derive(Default)]
pub struct AntigravityManager {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    gate: tokio::sync::Mutex<()>,
}
impl AntigravityManager {
    fn get(&self, id: &str) -> Result<Arc<Session>, String> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| "Open or resume this Antigravity panel first.".into())
    }
    /// App exit: stop every process and let active turns settle as interrupted
    /// so Activity does not keep them "running" forever.
    pub fn kill_all(&self) {
        let sessions: Vec<_> = self.sessions.lock().unwrap().drain().map(|(_, s)| s).collect();
        sessions.iter().for_each(|session| session.interrupt());
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline && sessions.iter().any(|s| s.lock().proc.is_some()) {
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}

async fn run(executable: &Executable, args: &[&str], seconds: u64) -> Result<String, String> {
    let mut command = tokio::process::Command::from(executable.command());
    command.args(args).stdin(Stdio::null()).kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(seconds), command.output())
        .await
        .map_err(|_| "The Antigravity CLI did not answer in time.".to_string())?
        .map_err(|e| format!("Cannot start Antigravity: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.lines().find(|l| !l.trim().is_empty()).unwrap_or("The Antigravity CLI reported an error.").trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// `agy models` prints `slug<TAB>Display name` after a progress line.
pub fn parse_models(output: &str) -> Vec<Value> {
    output
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(id, label)| (id.trim(), label.trim()))
        .filter(|(id, _)| !id.is_empty() && !id.contains(char::is_whitespace))
        .map(|(id, label)| json!({"id":id,"label":if label.is_empty() { id } else { label }}))
        .collect()
}

/// Whether `cmdkey /list:gemini:antigravity` shows the CLI's stored sign-in.
/// The header always repeats the queried name; a stored entry names it again
/// (as `Target: gemini:antigravity`). Counting avoids any localized wording.
pub fn credential_listed(output: &str) -> bool {
    output.to_lowercase().matches("gemini:antigravity").count() >= 2
}

/// Best-effort sign-in status without reading any secret. The official flow keeps
/// its token in the OS credential store; only its presence is checked here, and
/// only a real turn proves the token is still valid.
async fn auth_status() -> Value {
    let settings: Value = dirs::home_dir()
        .and_then(|home| std::fs::read(home.join(".gemini/antigravity-cli/settings.json")).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null);
    if settings["modelProvider"] == "gemini" {
        return if std::env::var_os("GEMINI_API_KEY").is_some_and(|key| !key.is_empty()) {
            json!({"state":"api-key","detail":"Using the Gemini API key from GEMINI_API_KEY (modelProvider is gemini in agy's settings.json)."})
        } else {
            json!({"state":"signed-out","detail":"agy's settings.json selects the Gemini API key provider, but GEMINI_API_KEY is not set in Tessera's environment."})
        };
    }
    #[cfg(windows)]
    let listed = {
        let mut command = tokio::process::Command::new("cmdkey");
        command.arg("/list:gemini:antigravity").stdin(Stdio::null()).kill_on_drop(true).creation_flags(0x0800_0000);
        match tokio::time::timeout(Duration::from_secs(8), command.output()).await {
            Ok(Ok(output)) if output.status.success() => Some(credential_listed(&String::from_utf8_lossy(&output.stdout))),
            _ => None,
        }
    };
    // macOS Keychain / Secret Service entries are not inspected.
    #[cfg(not(windows))]
    let listed: Option<bool> = None;
    match listed {
        Some(true) => json!({"state":"signed-in","detail":"A saved Antigravity sign-in was found in Windows Credential Manager. Its validity is confirmed when a turn runs."}),
        Some(false) => json!({"state":"signed-out","detail":"No saved Antigravity sign-in was found in Windows Credential Manager."}),
        None => json!({"state":"unknown","detail":"Sign-in is kept in the OS credential store and is verified when the first message is sent."}),
    }
}

#[tauri::command]
pub async fn antigravity_discover(executable_path: String) -> Result<Value, String> {
    let executable = executable::resolve(&executable_path)?;
    let version = run(&executable, &["--version"], 15)
        .await
        .map_err(|e| format!("The Antigravity version check failed: {e}"))?;
    let (models, auth) = tokio::join!(run(&executable, &["models"], 45), auth_status());
    let (models, models_error) = match models {
        Ok(output) => (parse_models(&output), None),
        Err(error) => (vec![], Some(error)),
    };
    Ok(json!({"path":executable.program.to_string_lossy(),"version":version.trim(),"models":models,
        "modelsError":models_error,"auth":auth}))
}

fn activity_sink(app: &AppHandle, id: &str) -> Sink {
    let (app, id) = (app.clone(), id.to_string());
    Arc::new(move |event| crate::activity::observe_antigravity(&app, &id, &event))
}

#[tauri::command]
pub async fn antigravity_configure(
    id: String,
    config: Config,
    conversation_id: Option<String>,
    start: bool,
    app: AppHandle,
    state: tauri::State<'_, AntigravityManager>,
) -> Result<Value, String> {
    let _guard = state.gate.lock().await;
    config.validate()?;
    if conversation_id.as_deref().is_some_and(|id| !safe_id(id)) {
        return Err("Invalid Antigravity conversation ID.".into());
    }
    let existing = state.sessions.lock().unwrap().get(&id).cloned();
    let session = if let Some(session) = existing {
        let changed = session.lock().config != config;
        if changed {
            // Model and permission flags are process arguments: apply them by
            // restarting an idle process. The conversation resumes by ID.
            if session.lock().transcript.busy() {
                return Err("Wait for the current turn to finish (or stop it) before changing this panel's settings.".into());
            }
            let executable = executable::resolve(&config.executable_path)?;
            session.stop_process();
            session.wait_stopped(Duration::from_secs(10)).await;
            let mut inner = session.lock();
            inner.config = config;
            inner.executable = executable;
            inner.init = Value::Null;
            drop(inner);
            session.bump();
        }
        session
    } else {
        if state.sessions.lock().unwrap().values().any(|s| s.lock().config.data_id == config.data_id) {
            return Err("This Antigravity conversation is already open in another panel.".into());
        }
        let executable = executable::resolve(&config.executable_path)?;
        let store = crate::app_paths::data_dir().join("antigravity").join(format!("{}.json", config.data_id));
        let session = Session::open(config, executable, conversation_id, store, activity_sink(&app, &id));
        state.sessions.lock().unwrap().insert(id.clone(), session.clone());
        session
    };
    if start {
        let _turns = session.gate.lock().await;
        if let Err(error) = session.ensure_ready().await {
            // A failed first start must not leave a half-open panel behind in the wizard.
            if session.lock().transcript.items.is_empty() {
                state.sessions.lock().unwrap().remove(&id);
            }
            return Err(error);
        }
        let mut guard = session.lock();
        session.persist(&mut guard);
    }
    Ok(session.snapshot())
}

#[tauri::command]
pub async fn antigravity_snapshot(
    id: String,
    known_revision: Option<String>,
    state: tauri::State<'_, AntigravityManager>,
) -> Result<Option<Value>, String> {
    let session = state.get(&id)?;
    if known_revision.as_deref() == Some(&session.revision()) {
        return Ok(None);
    }
    Ok(Some(session.snapshot()))
}

#[tauri::command]
pub async fn antigravity_send(id: String, text: String, state: tauri::State<'_, AntigravityManager>) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Enter a message.".into());
    }
    state.get(&id)?.send(text).await
}

#[tauri::command]
pub async fn antigravity_interrupt(id: String, state: tauri::State<'_, AntigravityManager>) -> Result<(), String> {
    let session = state.get(&id)?;
    // Stopping ends the process; never do that to an idle panel.
    if session.lock().transcript.busy() {
        session.interrupt();
    }
    Ok(())
}

/// Recovery for a conversation that no longer exists on this PC: keep the
/// visible transcript, forget the ID, and let the next message start a new one.
#[tauri::command]
pub async fn antigravity_new_conversation(id: String, state: tauri::State<'_, AntigravityManager>) -> Result<Value, String> {
    let session = state.get(&id)?;
    let _gate = session.gate.lock().await;
    if session.lock().transcript.busy() {
        return Err(BUSY.into());
    }
    session.stop_process();
    session.wait_stopped(Duration::from_secs(10)).await;
    {
        let mut guard = session.lock();
        let inner = &mut *guard;
        inner.conversation_id = None;
        inner.error = None;
        inner.recovery = None;
        inner.transcript.cumulative = None;
        if !inner.transcript.items.is_empty() {
            inner.transcript.note("info", "New Antigravity conversation. Messages above are kept for reference but are not in the agent's context.", now());
        }
        session.persist(inner);
    }
    session.bump();
    Ok(session.snapshot())
}

#[tauri::command]
pub async fn antigravity_close(id: String, state: tauri::State<'_, AntigravityManager>) -> Result<(), String> {
    let _guard = state.gate.lock().await;
    let session = state.sessions.lock().unwrap().remove(&id);
    if let Some(session) = session {
        // Keep the session alive until its reader settles an active turn.
        session.interrupt();
        session.wait_stopped(Duration::from_secs(5)).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn antigravity_terminal_spawn(
    id: String,
    cols: u16,
    rows: u16,
    initial_prompt: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, AntigravityManager>,
    pty: tauri::State<'_, crate::pty::manager::PtyManager>,
) -> Result<Value, String> {
    let session = state.get(&id)?;
    let _gate = session.gate.lock().await;
    // Without a saved sign-in the headless interface cannot start; the native
    // TUI is exactly where the official browser sign-in happens.
    let pinned = if auth_status().await["state"] == "signed-out" {
        Err(SIGN_IN.to_string())
    } else {
        session.pin().await
    };
    let (executable, config) = {
        let inner = session.lock();
        (inner.executable.clone(), inner.config.clone())
    };
    let missing = pinned.as_ref().is_err_and(|e| e.contains("was not found on this PC"));
    if missing {
        let error = pinned.unwrap_err();
        let mut inner = session.lock();
        inner.error = Some(error.clone());
        inner.recovery = Some("new_conversation");
        drop(inner);
        session.bump();
        return Err(error);
    }
    let mut command = portable_pty::CommandBuilder::new(&executable.program);
    command.args(&executable.args);
    command.args(config.flags(pinned.as_deref().ok()));
    if let Some(prompt) = initial_prompt.filter(|p| !p.trim().is_empty()) {
        command.args(["--prompt-interactive", prompt.as_str()]);
    }
    command.cwd(&config.cwd);
    for key in ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CODEX_THREAD_ID"] {
        command.env_remove(key);
    }
    crate::pty::manager::spawn_prepared(id, command, cols, rows, &app, &pty)?;
    let warning = pinned.as_ref().err().map(|error| {
        format!("This terminal started without a pinned conversation, so it cannot be resumed after a restart yet: {error} Sign in here if agy asks, then use Restart on this panel.")
    });
    {
        let mut inner = session.lock();
        inner.error = warning.clone();
        inner.recovery = warning.as_ref().map(|_| "login");
    }
    session.bump();
    Ok(json!({"conversationId":pinned.ok(),"warning":warning}))
}

pub async fn read_recent(app: &AppHandle, id: &str, limit: usize) -> Result<Vec<Value>, String> {
    let session = app.state::<AntigravityManager>().get(id)?;
    let messages = session.lock().transcript.messages(limit);
    Ok(messages)
}

/// Panel-bus and LAN delivery into a chat panel. A busy panel answers with an
/// explicit error instead of interrupting or silently queueing a turn.
pub async fn deliver(app: &AppHandle, id: &str, text: &str, wait: bool, timeout: u64) -> Result<Value, String> {
    let session = app.state::<AntigravityManager>().get(id)?;
    let before = session.lock().transcript.items.len();
    session.send(text.to_string()).await?;
    if !wait {
        return Ok(json!({"delivered":true,"panel":id}));
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout.clamp(1, 300));
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        {
            let inner = session.lock();
            if !inner.transcript.busy() {
                let items = &inner.transcript.items[before.min(inner.transcript.items.len())..];
                let reply = items.iter().filter(|i| i.kind == "assistant").map(|i| i.text.trim_end()).collect::<Vec<_>>().join("\n\n");
                let status = items.iter().rev().find(|i| i.kind == "result").map(|i| i.level.clone()).unwrap_or_default();
                return Ok(json!({"delivered":true,"reply":reply,"status":status,"is_error":status != "completed","error":inner.error}));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(json!({"delivered":true,"timed_out":true,"note":"Antigravity is still working. Use read_panel later to see its answer."}));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(cwd: &std::path::Path) -> Config {
        Config {
            cwd: cwd.to_string_lossy().into(),
            model: "gemini-3.8-flash-low".into(),
            effort: String::new(),
            permission: "review".into(),
            sandbox: false,
            executable_path: String::new(),
            data_id: uuid::Uuid::new_v4().to_string(),
        }
    }

    #[test]
    fn arguments_follow_the_installed_cli_flags() {
        let dir = std::env::temp_dir();
        let mut c = config(&dir);
        assert_eq!(
            c.stream_args(None),
            ["--input-format", "stream-json", "--output-format", "stream-json", "--model", "gemini-3.8-flash-low"]
        );
        c.permission = "accept-edits".into();
        c.effort = "high".into();
        c.sandbox = true;
        assert_eq!(
            c.flags(Some("055a398f-0000-4000-8000-000000000000")),
            ["--model", "gemini-3.8-flash-low", "--effort", "high", "--mode", "accept-edits", "--sandbox", "--conversation", "055a398f-0000-4000-8000-000000000000"]
        );
        c.permission = "skip".into();
        assert!(c.flags(None).contains(&"--dangerously-skip-permissions".to_string()));
        c.permission = "review".into();
        assert!(!c.flags(None).iter().any(|a| a == "--mode" || a.contains("skip")));
        c.validate().unwrap();
        for (field, value) in [("permission", "bypass"), ("effort", "ultra"), ("model", "--dangerously-skip-permissions"), ("data", "../other")] {
            let mut bad = c.clone();
            match field {
                "permission" => bad.permission = value.into(),
                "effort" => bad.effort = value.into(),
                "model" => bad.model = value.into(),
                _ => bad.data_id = value.into(),
            }
            assert!(bad.validate().is_err(), "{field} must be rejected");
        }
        c.cwd = "Z:/not-a-real-folder".into();
        assert!(c.validate().is_err());
    }

    #[test]
    fn parses_models_and_sign_in_listing_from_real_output() {
        let models = parse_models("Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n\nnot a model line\n");
        assert_eq!(models, vec![
            json!({"id":"gemini-3.8-flash-high","label":"Gemini 3.8 Flash (High)"}),
            json!({"id":"claude-opus-4-6-thinking","label":"Claude Opus 4.6 (Thinking)"}),
        ]);
        // Exact output of the filtered query on Windows 11 with a saved sign-in.
        assert!(credential_listed("\nCurrently stored credentials for gemini:antigravity:\n\n    Target: gemini:antigravity\n    Type: Generic \n    User: antigravity\n    Local machine persistence\n"));
        assert!(credential_listed("\nCurrently stored credentials for gemini:antigravity:\n\n    Target: LegacyGeneric:target=gemini:antigravity\n    Type: Generic\n    User: antigravity\n"));
        assert!(!credential_listed(""));
        assert!(!credential_listed("\nCurrently stored credentials for gemini:antigravity:\n\n* NONE *\n"));
        assert_eq!(recovery_for("error getting token source: You are not logged into Antigravity."), "login");
        assert_eq!(recovery_for("Antigravity exited unexpectedly (exit code 1)."), "retry");
        assert_eq!(recovery_for(&executable::resolve("Z:/missing/agy.exe").err().unwrap()), "executable");
    }

    fn collecting_sink() -> (Sink, Arc<Mutex<Vec<Value>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        (Arc::new(move |event| sink.lock().unwrap().push(event)), events)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_missing_executable_fails_the_turn_visibly_and_stays_retryable() {
        let root = std::env::temp_dir().join(format!("tessera-agy-missing-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let (sink, events) = collecting_sink();
        let executable = Executable { program: root.join("agy-not-installed.exe"), args: vec![] };
        let session = Session::open(config(&root), executable, None, root.join("panel.json"), sink);
        let error = session.send("hello".into()).await.unwrap_err();
        assert!(error.starts_with("Cannot start Antigravity"), "{error}");
        let snapshot = session.snapshot();
        assert_eq!(snapshot["busy"], false);
        assert_eq!(snapshot["recovery"], "executable");
        assert_eq!(snapshot["items"][0]["text"], "hello");
        assert_eq!(snapshot["items"].as_array().unwrap().last().unwrap()["level"], "failed");
        assert!(events.lock().unwrap().is_empty(), "a turn that never started is not an Activity turn");
        // The question survives a restart of the app.
        let reopened = Session::open(config(&root), Executable { program: root.join("x"), args: vec![] }, None, root.join("panel.json"), collecting_sink().0);
        assert_eq!(reopened.snapshot()["items"][0]["text"], "hello");
        let _ = std::fs::remove_dir_all(root);
    }

    /// Explicit opt-in: drives the real, signed-in agy CLI and makes model calls.
    /// TESSERA_ANTIGRAVITY_TEST_EXECUTABLE=<agy.exe> [TESSERA_ANTIGRAVITY_TEST_MODEL=<slug>]
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn live_antigravity_turns_resume_cancel_and_isolation() {
        let path = std::env::var("TESSERA_ANTIGRAVITY_TEST_EXECUTABLE").expect("Set TESSERA_ANTIGRAVITY_TEST_EXECUTABLE to agy");
        let model = std::env::var("TESSERA_ANTIGRAVITY_TEST_MODEL").unwrap_or_else(|_| "gemini-3.8-flash-low".into());
        let root = std::env::temp_dir().join(format!("tessera-agy-live-{}", uuid::Uuid::new_v4()));
        let open = |name: &str, conversation: Option<String>| {
            let cwd = root.join(name);
            std::fs::create_dir_all(&cwd).unwrap();
            let mut c = config(&cwd);
            c.model = model.clone();
            c.executable_path = path.clone();
            c.data_id = name.into();
            let (sink, events) = collecting_sink();
            (Session::open(c.clone(), executable::resolve(&path).unwrap(), conversation, root.join(format!("{name}.json")), sink), events)
        };
        async fn idle(session: &Arc<Session>) {
            for _ in 0..1200 {
                if !session.lock().transcript.busy() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            panic!("turn did not finish: {}", session.snapshot());
        }
        let last_reply = |session: &Arc<Session>| session.lock().transcript.messages(1)[0]["content"].as_str().unwrap().to_string();

        // Two panels work at the same time, each in its own process, folder and conversation.
        let (a, a_events) = open("panel-a", None);
        let (b, _) = open("panel-b", None);
        a.send("Remember the code word kestrel. Then write three sentences about owls.".into()).await.unwrap();
        // The turn was only just written to agy: a second message must be refused, not queued or interleaved.
        assert!(a.send("too early".into()).await.is_err_and(|e| e.contains("still working")), "a busy panel refuses a second turn");
        b.send("Remember the code word walrus. Reply with exactly: stored".into()).await.unwrap();
        idle(&a).await;
        idle(&b).await;
        assert!(b.snapshot()["processAlive"].as_bool().unwrap(), "both panels keep their own live process");
        let (conv_a, conv_b) = (a.lock().conversation_id.clone().unwrap(), b.lock().conversation_id.clone().unwrap());
        assert_ne!(conv_a, conv_b);
        assert!(a.snapshot()["processAlive"].as_bool().unwrap());

        // A second turn in the same process, then usage is cumulative for the conversation.
        a.send("What is the code word? Reply with just the word.".into()).await.unwrap();
        idle(&a).await;
        assert!(last_reply(&a).to_lowercase().contains("kestrel"), "{}", a.snapshot());
        let after_two = a.lock().transcript.cumulative.clone().unwrap();
        let per_turn: u64 = a.lock().transcript.items.iter().filter(|i| i.kind == "result").map(|i| i.usage.as_ref().unwrap().total).sum();
        assert_eq!(after_two.total, per_turn, "per-turn usage must add up to the CLI's conversation counter");

        // Stop mid-turn: the turn is interrupted, the panel stays usable, and the conversation continues.
        a.send("Write a 700-word essay about lighthouses.".into()).await.unwrap();
        for _ in 0..600 {
            if a.lock().transcript.items.iter().any(|i| i.kind == "assistant" && i.state == "active") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        a.interrupt();
        idle(&a).await;
        assert_eq!(a.lock().transcript.items.last().unwrap().level, "interrupted");
        assert!(a.wait_stopped(Duration::from_secs(10)).await);
        assert!(a.snapshot()["error"].is_null(), "a user stop is not an error");
        a.send("What is the code word? Reply with just the word.".into()).await.unwrap();
        idle(&a).await;
        assert!(last_reply(&a).to_lowercase().contains("kestrel"));
        assert_eq!(a.lock().conversation_id.as_deref(), Some(conv_a.as_str()));

        // Resume in a fresh session object by the exact ID, as a workspace restore does.
        a.stop_process();
        assert!(a.wait_stopped(Duration::from_secs(10)).await);
        drop(a);
        let (restored, restored_events) = open("panel-a", Some(conv_a.clone()));
        assert!(restored.snapshot()["items"].as_array().unwrap().len() >= 8, "the transcript is restored from Tessera's file");
        assert_eq!(restored.snapshot()["processAlive"], false, "restoring must not start a process or a model call");
        restored.send("One more time: the code word, just the word.".into()).await.unwrap();
        idle(&restored).await;
        assert!(last_reply(&restored).to_lowercase().contains("kestrel"));
        assert_eq!(restored.lock().conversation_id.as_deref(), Some(conv_a.as_str()));
        // Panel B never saw panel A's conversation.
        b.send("What is the code word? Reply with just the word.".into()).await.unwrap();
        idle(&b).await;
        assert!(last_reply(&b).to_lowercase().contains("walrus"));

        // Activity events: one start and one end per announced turn, with usage on completed turns.
        for events in [&a_events, &restored_events] {
            let events = events.lock().unwrap();
            let started: Vec<_> = events.iter().filter(|e| e["type"] == "turn_started").map(|e| e["turn"].clone()).collect();
            let finished: Vec<_> = events.iter().filter(|e| e["type"] == "turn_finished").collect();
            assert_eq!(started.len(), finished.len());
            assert!(finished.iter().all(|e| e["session"] == conv_a.as_str()));
            assert!(finished.iter().filter(|e| e["status"] == "completed").all(|e| e["cumulative"]["total_tokens"].as_u64().unwrap() > 0));
        }
        assert_eq!(a_events.lock().unwrap().iter().filter(|e| e["status"] == "interrupted").count(), 1);

        // A conversation that does not exist here is reported, not silently replaced.
        let (missing, _) = open("panel-missing", Some("00000000-0000-4000-8000-000000000000".into()));
        let error = missing.send("hello".into()).await.unwrap_err();
        assert!(error.contains("was not found on this PC"), "{error}");
        assert_eq!(missing.snapshot()["recovery"], "new_conversation");
        assert_eq!(missing.lock().conversation_id.as_deref(), Some("00000000-0000-4000-8000-000000000000"));
        assert!(missing.wait_stopped(Duration::from_secs(10)).await);

        // An unknown model is a visible startup error with the CLI's own explanation.
        let (bad, _) = open("panel-bad-model", None);
        bad.lock().config.model = "definitely-not-a-model".into();
        let error = bad.send("hello".into()).await.unwrap_err();
        assert!(error.contains("invalid model selection"), "{error}");
        assert_eq!(bad.snapshot()["busy"], false);

        // Terminal pinning: an exact ID with no turn, and the process is gone before the TUI starts.
        let (terminal, _) = open("panel-terminal", None);
        let pinned = terminal.pin().await.unwrap();
        assert!(safe_id(&pinned));
        assert!(terminal.lock().proc.is_none());
        assert_eq!(terminal.pin().await.unwrap(), pinned, "pinning again verifies the same conversation");

        // The native TUI starts on the pinned conversation in a real PTY, exactly as a terminal panel runs it.
        let screen = {
            use std::io::Read;
            let pair = portable_pty::native_pty_system()
                .openpty(portable_pty::PtySize { rows: 30, cols: 110, pixel_width: 0, pixel_height: 0 })
                .unwrap();
            let (executable, config) = {
                let inner = terminal.lock();
                (inner.executable.clone(), inner.config.clone())
            };
            let mut command = portable_pty::CommandBuilder::new(&executable.program);
            command.args(config.flags(Some(&pinned)));
            command.cwd(&config.cwd);
            let mut child = pair.slave.spawn_command(command).unwrap();
            drop(pair.slave);
            let mut writer = pair.master.take_writer().unwrap();
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
            let deadline = Instant::now() + Duration::from_secs(25);
            let mut wire = String::new();
            let mut quiet_since = Instant::now();
            while Instant::now() < deadline {
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(bytes) => {
                        let text = String::from_utf8_lossy(&bytes).into_owned();
                        // Answer the terminal queries a TUI waits for.
                        if text.contains("\x1b[6n") {
                            let _ = writer.write_all(b"\x1b[1;1R");
                        }
                        if text.contains("\x1b[c") {
                            let _ = writer.write_all(b"\x1b[?1;2c");
                        }
                        let _ = writer.flush();
                        wire.push_str(&text);
                        quiet_since = Instant::now();
                    }
                    Err(_) if wire.len() > 400 && quiet_since.elapsed() > Duration::from_secs(4) => break,
                    Err(_) => {}
                }
                if child.try_wait().unwrap().is_some() {
                    break;
                }
            }
            let alive = child.try_wait().unwrap().is_none();
            if let Some(pid) = child.process_id() {
                crate::util::proc::kill_tree(pid);
            }
            let _ = child.kill();
            let plain: String = wire.chars().filter(|c| !c.is_control()).collect();
            println!("TUI alive={alive} bytes={} screen: {}", wire.len(), plain.chars().take(1500).collect::<String>());
            assert!(alive, "the native terminal must keep running on the pinned conversation");
            plain
        };
        assert!(screen.len() > 200, "the TUI rendered nothing");
        assert!(!screen.to_lowercase().contains("not found"), "the pinned conversation must be accepted by the TUI");
        for session in [&restored, &b, &terminal] {
            session.stop_process();
            session.wait_stopped(Duration::from_secs(10)).await;
        }
        let _ = std::fs::remove_dir_all(root);
    }
}
