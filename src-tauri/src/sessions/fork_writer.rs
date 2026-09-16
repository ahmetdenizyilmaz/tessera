//! Write a conversation into a brand-new session file so the CLI resumes it
//! natively. Used by Fork: the new panel starts with the earlier turns in its
//! transcript and in the model's context, without any prompt tricks.
//!
//! Claude Code reads `~/.claude/projects/<encoded cwd>/<session>.jsonl`; Codex
//! reads `~/.codex/sessions/YYYY/MM/DD/rollout-<stamp>-<thread>.jsonl`. Both
//! formats were verified by resuming hand-written files with the CLIs.

use std::path::PathBuf;

use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::json;

use crate::util::claude_paths;

/// Fallback when no existing session file reveals the installed CLI version.
const CLAUDE_VERSION_FALLBACK: &str = "2.1.273";
/// The Codex release Tessera is built against.
const CODEX_VERSION: &str = "0.154.0";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub timestamp: Option<String>,
}

fn stamp(base: DateTime<Utc>, index: usize, given: &Option<String>) -> DateTime<Utc> {
    given
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.with_timezone(&Utc))
        .unwrap_or(base + Duration::seconds(index as i64))
}

fn iso(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// The `version` the installed Claude Code writes, taken from any session file
/// it already produced, so the synthetic file looks like the CLI's own.
fn claude_version() -> String {
    let root = claude_paths::projects_dir();
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for dir in std::fs::read_dir(&root).into_iter().flatten().flatten() {
        for file in std::fs::read_dir(dir.path()).into_iter().flatten().flatten() {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(modified) = file.metadata().and_then(|m| m.modified()) else {
                continue;
            };
            if newest.as_ref().is_none_or(|(t, _)| modified > *t) {
                newest = Some((modified, path));
            }
        }
    }
    if let Some((_, path)) = newest {
        if let Ok(text) = std::fs::read_to_string(&path) {
            for line in text.lines().take(50) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(v) = value.get("version").and_then(|v| v.as_str()) {
                        return v.to_string();
                    }
                }
            }
        }
    }
    CLAUDE_VERSION_FALLBACK.to_string()
}

/// Create a Claude Code session file holding `messages` and return its id.
/// `model` labels the assistant turns; Claude Code only displays it.
#[tauri::command]
pub async fn session_write_fork(
    project_path: String,
    messages: Vec<ForkMessage>,
    model: Option<String>,
) -> Result<String, String> {
    if messages.is_empty() {
        return Err("Nothing to write".into());
    }
    let cwd = claude_paths::resolve_work_dir(&project_path);
    let encoded = claude_paths::encode_project_path(&cwd);
    let dir = claude_paths::find_project_dir(&encoded)
        .unwrap_or_else(|| claude_paths::projects_dir().join(&encoded));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Create session directory: {e}"))?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let version = claude_version();
    let model = model.filter(|m| !m.trim().is_empty()).unwrap_or_else(|| "claude".into());
    let base = Utc::now() - Duration::seconds(messages.len() as i64 + 1);
    let mut parent: Option<String> = None;
    let mut lines = Vec::with_capacity(messages.len());
    for (i, m) in messages.iter().enumerate() {
        let id = uuid::Uuid::new_v4().to_string();
        let when = iso(stamp(base, i, &m.timestamp));
        let common = json!({
            "parentUuid": parent,
            "isSidechain": false,
            "userType": "external",
            "cwd": cwd,
            "sessionId": session_id,
            "version": version,
            "gitBranch": "",
            "entrypoint": "cli",
            "uuid": id,
            "timestamp": when,
        });
        let mut line = common;
        if m.role == "user" {
            line["type"] = json!("user");
            line["message"] = json!({ "role": "user", "content": m.content });
        } else {
            line["type"] = json!("assistant");
            line["requestId"] = json!(format!("req_{}", &id[..8]));
            line["message"] = json!({
                "id": format!("msg_{}", id.replace('-', "")),
                "type": "message",
                "role": "assistant",
                "model": model,
                "content": [{ "type": "text", "text": m.content }],
                "stop_reason": "end_turn",
                "stop_sequence": null,
                "usage": { "input_tokens": 0, "output_tokens": 0 },
            });
        }
        lines.push(line.to_string());
        parent = Some(id);
    }
    let path = dir.join(format!("{session_id}.jsonl"));
    std::fs::write(&path, lines.join("\n") + "\n").map_err(|e| format!("Write session file: {e}"))?;
    Ok(session_id)
}

fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".codex"))
}

/// Create a Codex rollout holding `messages` and return the new thread id.
#[tauri::command]
pub async fn codex_write_fork_thread(
    cwd: String,
    messages: Vec<ForkMessage>,
) -> Result<String, String> {
    if messages.is_empty() {
        return Err("Nothing to write".into());
    }
    let now = Utc::now();
    let dir = codex_home()
        .join("sessions")
        .join(now.format("%Y").to_string())
        .join(now.format("%m").to_string())
        .join(now.format("%d").to_string());
    std::fs::create_dir_all(&dir).map_err(|e| format!("Create rollout directory: {e}"))?;

    let thread_id = uuid::Uuid::new_v4().to_string();
    let base = now - Duration::seconds(messages.len() as i64 + 1);
    let mut lines = vec![json!({
        "timestamp": iso(base),
        "ordinal": 0,
        "type": "session_meta",
        "payload": {
            "session_id": thread_id,
            "id": thread_id,
            "timestamp": iso(base),
            "cwd": cwd,
            "originator": "tessera",
            "cli_version": CODEX_VERSION,
            "source": "cli",
            "model_provider": "openai",
            "history_mode": "paginated",
            "context_window": { "window_id": uuid::Uuid::new_v4().to_string() },
        },
    })
    .to_string()];
    for (i, m) in messages.iter().enumerate() {
        let user = m.role == "user";
        lines.push(
            json!({
                "timestamp": iso(stamp(base, i + 1, &m.timestamp)),
                "ordinal": i + 1,
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "id": format!("msg_{}", uuid::Uuid::new_v4()),
                    "role": if user { "user" } else { "assistant" },
                    "content": [{ "type": if user { "input_text" } else { "output_text" }, "text": m.content }],
                },
            })
            .to_string(),
        );
    }
    let file = dir.join(format!(
        "rollout-{}-{thread_id}.jsonl",
        now.format("%Y-%m-%dT%H-%M-%S")
    ));
    std::fs::write(&file, lines.join("\n") + "\n").map_err(|e| format!("Write rollout: {e}"))?;
    Ok(thread_id)
}
