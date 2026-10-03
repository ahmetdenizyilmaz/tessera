//! Durable, local activity history. Provider readers send only completed items
//! and usage updates here; recording never depends on a mounted React panel.
mod claude;
pub mod model;
#[cfg(test)]
mod tests;

use crate::{
    db::Database,
    panelbus::{registry::PanelInfo, PanelBus},
};
use model::*;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

pub fn create_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS activity_records (
        id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, panel_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_records(started_at, id);
        CREATE INDEX IF NOT EXISTS idx_activity_panel ON activity_records(panel_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_activity_session ON activity_records(json_extract(data,'$.actor.provider'), json_extract(data,'$.sessionId'), kind, started_at DESC, id DESC);
        CREATE TABLE IF NOT EXISTS activity_counters (id TEXT PRIMARY KEY, data TEXT NOT NULL);")
}
fn save(conn: &Connection, record: &Record) -> Result<(), String> {
    conn.execute(
        "INSERT INTO activity_records(id,started_at,panel_id,kind,data) VALUES (?1,?2,?3,?4,?5)
        ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        rusqlite::params![
            record.id,
            record.started_at,
            record.actor.id,
            record.kind,
            serde_json::to_string(record).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn get(conn: &Connection, id: &str) -> Result<Option<Record>, String> {
    let raw: Option<String> = conn
        .query_row("SELECT data FROM activity_records WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        .transpose()
}
fn latest_turn(conn: &Connection, panel: &str, at: i64) -> Result<Option<String>, String> {
    conn.query_row("SELECT id FROM activity_records WHERE panel_id=?1 AND kind='turn' AND started_at<=?2 ORDER BY started_at DESC,id DESC LIMIT 1",
        rusqlite::params![panel, at], |r| r.get(0)).optional().map_err(|e| e.to_string())
}

enum Command {
    Codex {
        actor: Actor,
        message: Value,
        at: i64,
    },
    Antigravity {
        actor: Actor,
        event: Value,
        at: i64,
    },
    Handoff(Record),
    Delivered {
        id: String,
        result: Result<Value, String>,
    },
    Flush(mpsc::Sender<()>),
}
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub error: Option<String>,
    pub last_scan: i64,
}
pub struct Recorder {
    tx: mpsc::Sender<Command>,
    health: Arc<Mutex<Health>>,
}
impl Recorder {
    pub fn start(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        let health = Arc::new(Mutex::new(Health::default()));
        let worker_health = health.clone();
        std::thread::spawn(move || {
            let mut transcripts = HashMap::<String, claude::Transcript>::new();
            let mut active = HashMap::<String, String>::new();
            let mut scan_at = Instant::now();
            loop {
                let received = rx.recv_timeout(Duration::from_millis(250));
                if matches!(received, Err(mpsc::RecvTimeoutError::Disconnected)) {
                    break;
                }
                if scan_at.elapsed() >= Duration::from_secs(2) {
                    let result = scan_claude(&app, &mut transcripts);
                    let mut h = worker_health.lock().unwrap_or_else(|e| e.into_inner());
                    h.last_scan = now();
                    if let Err(error) = result {
                        h.error = Some(error);
                    }
                    scan_at = Instant::now();
                }
                if let Ok(command) = received {
                    if let Command::Flush(done) = command {
                        if let Err(error) = scan_claude(&app, &mut transcripts) {
                            worker_health
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .error = Some(error);
                        }
                        let _ = done.send(());
                        continue;
                    }
                    // Refresh Claude's current question before attaching an outgoing handoff.
                    if matches!(&command, Command::Handoff(_)) {
                        if let Err(error) = scan_claude(&app, &mut transcripts) {
                            worker_health
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .error = Some(error);
                        }
                    }
                    let db = app.state::<Database>();
                    let result =
                        db.conn
                            .lock()
                            .map_err(|e| e.to_string())
                            .and_then(|conn| match command {
                                Command::Codex { actor, message, at } => {
                                    codex_event(&conn, &mut active, actor, &message, at)
                                }
                                Command::Antigravity { actor, event, at } => {
                                    antigravity_event(&conn, actor, &event, at)
                                }
                                Command::Handoff(mut record) => {
                                    record.parent_id = if record.actor.provider == "claude" {
                                        let session = crate::stream::manager::session_id_of(
                                            &app,
                                            &record.actor.id,
                                        )
                                        .or_else(|| {
                                            app.state::<PanelBus>().with_registry(|r| {
                                                r.get(&record.actor.id)
                                                    .and_then(|p| p.session_id.clone())
                                            })
                                        });
                                        session.and_then(|s| {
                                            transcripts
                                                .get(&s)
                                                .and_then(|reader| reader.current_id())
                                        })
                                    } else {
                                        latest_turn(&conn, &record.actor.id, record.started_at)?
                                    };
                                    save(&conn, &record)
                                }
                                Command::Delivered { id, result } => {
                                    if let Some(mut record) = get(&conn, &id)? {
                                        record.updated_at = now();
                                        match result {
                                            Ok(value) => {
                                                record.status = if value["status"] == "queued" {
                                                    "queued"
                                                } else {
                                                    "delivered"
                                                }
                                                .into();
                                            }
                                            Err(error) => {
                                                record.status = "failed".into();
                                                record.response = error;
                                            }
                                        }
                                        save(&conn, &record)?;
                                    }
                                    Ok(())
                                }
                                Command::Flush(_) => Ok(()),
                            });
                    if let Err(error) = result {
                        worker_health
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .error = Some(error);
                    }
                }
            }
        });
        Self { tx, health }
    }
    fn send(&self, command: Command) {
        if self.tx.send(command).is_err() {
            self.health.lock().unwrap_or_else(|e| e.into_inner()).error =
                Some("Activity recorder stopped. Restart Tessera to resume recording.".into());
        }
    }
    pub fn flush(&self) {
        let (tx, rx) = mpsc::channel();
        self.send(Command::Flush(tx));
        let _ = rx.recv_timeout(Duration::from_secs(5));
    }
}

fn panel_actor(app: &AppHandle, id: &str, provider: &str) -> Actor {
    app.try_state::<PanelBus>()
        .and_then(|bus| bus.with_registry(|r| r.get(id).map(Actor::panel)))
        .unwrap_or_else(|| Actor {
            id: id.into(),
            name: format!("{} chat", provider),
            provider: provider.into(),
            model: None,
            device: None,
        })
}
pub fn observe_codex(app: &AppHandle, id: &str, message: &Value) {
    let method = message["method"].as_str().unwrap_or("");
    if !matches!(
        method,
        "turn/started"
            | "turn/completed"
            | "item/started"
            | "item/completed"
            | "thread/tokenUsage/updated"
            | "activity/session"
            | "tessera/disconnected"
    ) {
        return;
    }
    if method.starts_with("item/")
        && !matches!(
            message["params"]["item"]["type"].as_str(),
            Some(
                "userMessage"
                    | "agentMessage"
                    | "commandExecution"
                    | "fileChange"
                    | "webSearch"
                    | "mcpToolCall"
                    | "dynamicToolCall"
                    | "plan"
            )
        )
    {
        return;
    }
    if let Some(recorder) = app.try_state::<Recorder>() {
        recorder.send(Command::Codex {
            actor: panel_actor(app, id, "codex"),
            message: message.clone(),
            at: now(),
        });
    }
}
/// Normalized turn events from an Antigravity chat panel's owned `agy` process.
pub fn observe_antigravity(app: &AppHandle, id: &str, event: &Value) {
    if let Some(recorder) = app.try_state::<Recorder>() {
        recorder.send(Command::Antigravity {
            actor: panel_actor(app, id, "antigravity"),
            event: event.clone(),
            at: now(),
        });
    }
}

fn antigravity_event(conn: &Connection, actor: Actor, event: &Value, at: i64) -> Result<(), String> {
    let Some(session) = event["session"].as_str().filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    let counter = format!("antigravity:{session}");
    let baseline = |conn: &Connection| -> Result<Option<Usage>, String> {
        let raw: Option<String> = conn
            .query_row("SELECT data FROM activity_counters WHERE id=?1", [&counter], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    };
    let kind = event["type"].as_str().unwrap_or("");
    if kind == "session" {
        // A conversation created by this panel starts from zero. A resumed one has
        // no baseline until its first observed result.
        if event["fresh"] == true {
            conn.execute(
                "INSERT OR IGNORE INTO activity_counters(id,data) VALUES (?1,?2)",
                rusqlite::params![counter, serde_json::to_string(&Usage::default()).unwrap()],
            )
            .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let Some(turn) = event["turn"].as_str() else {
        return Ok(());
    };
    let id = format!("antigravity:{session}:{turn}");
    let existing = get(conn, &id)?;
    // A repeated or late event must not reopen, re-count, or rewrite a closed turn.
    if existing
        .as_ref()
        .is_some_and(|r| matches!(r.status.as_str(), "completed" | "failed" | "interrupted"))
    {
        return Ok(());
    }
    let mut record = match (existing, kind) {
        (Some(record), _) => record,
        (None, "turn_started") => Record::turn(id, actor.clone(), session.into(), at),
        // Nothing may invent a turn without its question.
        (None, _) => return Ok(()),
    };
    record.actor = actor;
    record.updated_at = at;
    match kind {
        "turn_started" => {
            record.status = "running".into();
            if record.prompt.is_empty() {
                record.set_prompt(event["prompt"].as_str().unwrap_or("").into());
            }
        }
        "tool" => {
            let Some(tool) = event["tool"].as_str() else {
                return Ok(());
            };
            record.current_tool = (event["active"] == true).then(|| tool.to_string());
            if !record.tools.iter().any(|name| name == tool) {
                record.tools.push(tool.into());
            }
        }
        "response" => {
            let key = event["step"].to_string();
            let text = event["text"].as_str().unwrap_or("").trim_end().to_string();
            if let Some(part) = record.response_parts.iter_mut().find(|(k, _)| *k == key) {
                part.1 = text;
            } else {
                record.response_parts.push((key, text));
            }
            record.current_tool = None;
            record.response = record
                .response_parts
                .iter()
                .map(|(_, text)| text.as_str())
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
        }
        "turn_finished" => {
            record.status = event["status"].as_str().unwrap_or("failed").into();
            record.current_tool = None;
            if record.response.is_empty() {
                record.response = event["response"].as_str().unwrap_or("").into();
            }
            let cumulative = Usage::antigravity(&event["cumulative"]);
            let steps = Usage::antigravity(&event["steps"]);
            let previous = baseline(conn)?;
            let (usage, next) = match (cumulative, previous) {
                // The CLI's conversation counter is authoritative when its baseline is known.
                (Some(total), Some(previous)) if total.total() >= previous.total() => {
                    (Some(total.delta(&previous)), Some(total))
                }
                // Resumed without an observed baseline, or the counter restarted:
                // use only what this turn reported, never the conversation's lifetime.
                (Some(total), _) => {
                    record.usage_note = Some(if steps.is_some() {
                        "Counted from this turn's reported steps; the conversation's earlier usage was not observed.".into()
                    } else {
                        "Antigravity reported only a conversation total that Tessera had no baseline for, so this turn's usage is unavailable.".to_string()
                    });
                    (steps, Some(total))
                }
                // Stopped or crashed: no final counter. Keep what completed steps
                // reported and move the baseline so the next turn is not charged for them.
                (None, previous) => {
                    record.usage_note = Some(if steps.is_some() {
                        "The turn ended without a final usage report; only its completed steps are counted.".into()
                    } else {
                        "Antigravity did not report token usage for this turn.".to_string()
                    });
                    let next = previous.zip(steps.clone()).map(|(mut base, partial)| {
                        base.add(&partial);
                        base
                    });
                    (steps, next)
                }
            };
            record.usage = usage;
            // Record and baseline commit together, or a restart could count a delta twice.
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            save(&tx, &record)?;
            if let Some(next) = next {
                tx.execute("INSERT INTO activity_counters(id,data) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                    rusqlite::params![counter, serde_json::to_string(&next).unwrap()]).map_err(|e| e.to_string())?;
            }
            return tx.commit().map_err(|e| e.to_string());
        }
        _ => return Ok(()),
    }
    save(conn, &record)
}

pub fn begin_handoff(app: &AppHandle, caller: &str, target: &PanelInfo, text: &str) -> String {
    let trace = uuid::Uuid::new_v4().to_string();
    if let Some(recorder) = app.try_state::<Recorder>() {
        let mut record = Record::turn(
            format!("handoff:{trace}"),
            panel_actor(app, caller, "unknown"),
            String::new(),
            now(),
        );
        record.kind = "handoff".into();
        record.origin = "panel".into();
        record.status = "sending".into();
        record.target = Some(Actor::panel(target));
        record.prompt = text.into();
        recorder.send(Command::Handoff(record));
    }
    trace
}
pub fn finish_handoff(app: &AppHandle, trace: &str, result: &Result<Value, String>) {
    if let Some(recorder) = app.try_state::<Recorder>() {
        recorder.send(Command::Delivered {
            id: format!("handoff:{trace}"),
            result: result.clone(),
        });
    }
}

fn scan_claude(
    app: &AppHandle,
    transcripts: &mut HashMap<String, claude::Transcript>,
) -> Result<(), String> {
    let panels = app.state::<PanelBus>().local_panels();
    // Keep watching sessions opened during this run after their panel closes:
    // the CLI may flush its final response just after leaving the registry.
    let mut sources: HashMap<String, (Actor, std::path::PathBuf)> = transcripts
        .iter()
        .filter_map(|(session, reader)| {
            reader
                .actor
                .as_ref()
                .map(|actor| (session.clone(), (actor.clone(), reader.path.clone())))
        })
        .collect();
    for panel in panels
        .iter()
        .filter(|p| p.provider.as_deref().unwrap_or("claude") == "claude" && p.kind != "llm")
    {
        let session = crate::stream::manager::session_id_of(app, &panel.id)
            .or_else(|| panel.session_id.clone());
        let Some(session) = session.filter(|s| !s.is_empty()) else {
            continue;
        };
        let reader = transcripts.entry(session.clone()).or_default();
        let path = if reader.path.exists() {
            reader.path.clone()
        } else {
            crate::util::claude_paths::session_file_path(&panel.cwd, &session)
        };
        sources.insert(session, (Actor::panel(panel), path));
    }
    for (session, (actor, path)) in sources {
        let reader = transcripts.entry(session.clone()).or_default();
        let checkpoint = reader.clone();
        let changed = reader.read(&path, &actor, &session)?;
        if !changed.is_empty() {
            let db = app.state::<Database>();
            let result = (|| {
                let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
                let tx = conn.transaction().map_err(|e| e.to_string())?;
                for record in changed {
                    save(&tx, &record)?;
                }
                tx.commit().map_err(|e| e.to_string())
            })();
            if let Err(error) = result {
                *reader = checkpoint;
                return Err(error);
            }
        }
    }
    Ok(())
}

fn codex_event(
    conn: &Connection,
    active: &mut HashMap<String, String>,
    actor: Actor,
    event: &Value,
    at: i64,
) -> Result<(), String> {
    let p = &event["params"];
    let method = event["method"].as_str().unwrap_or("");
    let Some(session) = p["threadId"].as_str() else {
        return Ok(());
    };
    if method == "activity/session" {
        if p["fresh"] == true {
            conn.execute(
                "INSERT OR IGNORE INTO activity_counters(id,data) VALUES (?1,?2)",
                rusqlite::params![session, serde_json::to_string(&Usage::default()).unwrap()],
            )
            .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let turn = p["turnId"]
        .as_str()
        .or_else(|| p["turn"]["id"].as_str())
        .map(String::from)
        .or_else(|| active.get(session).cloned());
    let Some(turn) = turn else {
        return Ok(());
    };
    let id = format!("codex:{session}:{turn}");
    let existing = get(conn, &id)?;
    // A resume can report counters for an old turn before any new activity.
    // Seed the baseline without inventing a question at the time of reconnect.
    if method == "thread/tokenUsage/updated" && existing.is_none() {
        if let Some(total) = Usage::codex(&p["tokenUsage"]["total"]) {
            conn.execute("INSERT INTO activity_counters(id,data) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                rusqlite::params![session, serde_json::to_string(&total).unwrap()]).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    active.insert(session.into(), turn.clone());
    let mut record =
        existing.unwrap_or_else(|| Record::turn(id, actor.clone(), session.into(), at));
    record.actor = actor;
    record.updated_at = at;
    match method {
        "turn/started" => record.status = "running".into(),
        "turn/completed" => {
            record.status = p["turn"]["status"]
                .as_str()
                .unwrap_or("completed")
                .to_string()
        }
        "tessera/disconnected" => {
            if record.status != "running" {
                return Ok(());
            }
            record.status = "interrupted".into();
        }
        "item/started" | "item/completed" => {
            let item = &p["item"];
            let tool = match item["type"].as_str() {
                Some("commandExecution") => Some("Bash"),
                Some("fileChange") => Some("Edit"),
                Some("webSearch") => Some("WebSearch"),
                Some("plan") => Some("TodoWrite"),
                Some("mcpToolCall" | "dynamicToolCall") => item["tool"].as_str().or(Some("Tool")),
                _ => None,
            };
            record.current_tool = tool.map(String::from);
            if let Some(tool) = tool {
                if !record.tools.iter().any(|name| name == tool) {
                    record.tools.push(tool.into());
                }
            }
            if item["type"] == "userMessage" {
                let text = text_content(&item["content"]);
                if !text.is_empty() {
                    if let Some(id) = item["id"].as_str() {
                        let first = record.prompt_parts.is_empty();
                        let clean = trace_message(&text)
                            .map(|(_, text)| text)
                            .unwrap_or_else(|| text.clone());
                        if let Some(part) =
                            record.prompt_parts.iter_mut().find(|part| part.id == id)
                        {
                            part.text = clean;
                        } else {
                            record.prompt_parts.push(Prompt {
                                id: id.into(),
                                text: clean,
                                at,
                            });
                        }
                        if first {
                            record.set_prompt(text);
                        }
                        record.prompt = record
                            .prompt_parts
                            .iter()
                            .map(|part| part.text.as_str())
                            .collect::<Vec<_>>()
                            .join("\n\n");
                    }
                }
            } else if method == "item/completed" && item["type"] == "agentMessage" {
                if let (Some(id), Some(text)) = (item["id"].as_str(), item["text"].as_str()) {
                    if let Some(part) = record.response_parts.iter_mut().find(|(key, _)| key == id)
                    {
                        part.1 = text.into();
                    } else {
                        record.response_parts.push((id.into(), text.into()));
                    }
                    record.response = record
                        .response_parts
                        .iter()
                        .map(|(_, text)| text.as_str())
                        .collect::<Vec<_>>()
                        .join("\n\n");
                }
            }
        }
        "thread/tokenUsage/updated" => {
            let Some(total) = Usage::codex(&p["tokenUsage"]["total"]) else {
                return Ok(());
            };
            let previous: Option<String> = conn
                .query_row(
                    "SELECT data FROM activity_counters WHERE id=?1",
                    [session],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let previous = previous.and_then(|s| serde_json::from_str::<Usage>(&s).ok());
            let delta = match previous {
                Some(previous) if total.total() >= previous.total() => total.delta(&previous),
                _ => {
                    record.usage_note = Some("Usage starts at the first observed update; earlier work in this turn may be unavailable.".into());
                    let Some(last) = Usage::codex(&p["tokenUsage"]["last"]) else {
                        return Ok(());
                    };
                    last
                }
            };
            record.usage.get_or_insert_with(Usage::default).add(&delta);
            // Record and baseline must commit together, or a restart could count a delta twice.
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            save(&tx, &record)?;
            tx.execute("INSERT INTO activity_counters(id,data) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                rusqlite::params![session, serde_json::to_string(&total).unwrap()]).map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(());
        }
        _ => return Ok(()),
    }
    save(conn, &record)
}

/// Recorded usage of one Codex/Antigravity conversation, for the Session usage dialog.
/// Tokens only: subscription use has no per-token price to report.
#[tauri::command]
pub async fn activity_session_usage(
    provider: String,
    session_id: String,
    db: tauri::State<'_, Database>,
) -> Result<crate::sessions::usage_parser::UsageInfo, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT data FROM activity_records WHERE kind='turn' AND json_extract(data,'$.actor.provider')=?1 AND json_extract(data,'$.sessionId')=?2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![provider, session_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut info = crate::sessions::usage_parser::UsageInfo::default();
    let mut models = std::collections::BTreeSet::new();
    for raw in rows {
        let record: Record = serde_json::from_str(&raw.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let Some(usage) = record.usage else { continue };
        info.input_tokens += usage.input;
        info.output_tokens += usage.output;
        info.cache_read_tokens += usage.cache_read;
        info.cache_write_tokens += usage.cache_write;
        info.message_count += 1;
        if let Some(model) = record.actor.model {
            models.insert(model);
        }
    }
    info.models = models.into_iter().collect();
    Ok(info)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub at: i64,
    pub id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub records: Vec<Record>,
    pub has_more: bool,
    pub health: Health,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    provider: String,
    session_id: String,
}
fn latest_session_turn(conn: &Connection, session: &LiveSession) -> Result<Option<Record>, String> {
    let raw: Option<String> = conn.query_row(
        "SELECT data FROM activity_records WHERE json_extract(data,'$.actor.provider')=?1 AND json_extract(data,'$.sessionId')=?2 AND kind='turn' ORDER BY started_at DESC,id DESC LIMIT 1",
        rusqlite::params![session.provider, session.session_id], |r| r.get(0))
        .optional().map_err(|e| e.to_string())?;
    raw.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string())).transpose()
}
#[tauri::command]
pub async fn activity_list(
    before: Option<Cursor>,
    since: Option<i64>,
    limit: Option<usize>,
    refresh_ids: Option<Vec<String>>,
    live_sessions: Option<Vec<LiveSession>>,
    app: AppHandle,
    db: tauri::State<'_, Database>,
) -> Result<Page, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let (mut records, has_more) = read_page(&conn, before, since, limit)?;
    // A long-running turn can begin before the latest page. Refresh pending
    // records the view already loaded without changing its pagination boundary.
    for id in refresh_ids.unwrap_or_default().into_iter().take(1000) {
        if !records.iter().any(|r| r.id == id) {
            if let Some(record) = get(&conn, &id)? {
                records.push(record);
            }
        }
    }
    // Keep these outside the paginated rows. Office activity follows the real
    // session identity and must not be limited by its coin-earning start date.
    for session in live_sessions.unwrap_or_default().into_iter().take(1000) {
        if let Some(record) = latest_session_turn(&conn, &session)? {
            if !records.iter().any(|r| r.id == record.id) { records.push(record); }
        }
    }
    let health = app
        .state::<Recorder>()
        .health
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    Ok(Page {
        records,
        has_more,
        health,
    })
}

fn read_page(
    conn: &Connection,
    before: Option<Cursor>,
    since: Option<i64>,
    limit: Option<usize>,
) -> Result<(Vec<Record>, bool), String> {
    let limit = limit.unwrap_or(300).clamp(1, 1000);
    let at = before.as_ref().map(|c| c.at).unwrap_or(i64::MAX);
    let id = before.as_ref().map(|c| c.id.as_str()).unwrap_or("");
    let mut stmt = conn.prepare("SELECT data FROM activity_records WHERE started_at>=?1 AND (started_at<?2 OR (started_at=?2 AND id<?3)) ORDER BY started_at DESC,id DESC LIMIT ?4").map_err(|e| e.to_string())?;
    let raws = stmt
        .query_map(
            rusqlite::params![since.unwrap_or(0), at, id, limit + 1],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;
    let mut records = Vec::new();
    for raw in raws {
        records.push(
            serde_json::from_str::<Record>(&raw.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?,
        );
    }
    let has_more = records.len() > limit;
    records.truncate(limit);
    Ok((records, has_more))
}
