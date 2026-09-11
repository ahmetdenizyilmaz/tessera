use crate::util::claude_paths;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufRead;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub display: String,
    pub project: String,
    /// Seconds since epoch — the dialogs render `new Date(timestamp * 1000)`.
    pub timestamp: f64,
    pub has_file: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryLine {
    display: Option<String>,
    timestamp: Option<f64>,
    project: Option<String>,
    session_id: Option<String>,
}

/// history.jsonl timestamps are epoch milliseconds; older builds wrote
/// seconds. Normalize everything to seconds.
fn to_epoch_secs(ts: f64) -> f64 {
    if ts > 1.0e12 { ts / 1000.0 } else { ts }
}

/// display, project, latest timestamp (seconds) per session id, from
/// ~/.claude/history.jsonl.
///
/// History is the CLI's *prompt* log, not a session index: sessions driven
/// non-interactively never appear, and the CLI has been observed (v2.1.x)
/// silently skipping ordinary interactive sessions too. It can enrich the
/// list but must never gate it — the transcripts on disk are the truth.
fn scan_history() -> HashMap<String, (String, String, f64)> {
    let mut sessions: HashMap<String, (String, String, f64)> = HashMap::new();

    let file = match std::fs::File::open(claude_paths::history_jsonl_path()) {
        Ok(f) => f,
        Err(_) => return sessions,
    };
    let reader = std::io::BufReader::new(file);

    // Group by sessionId, keeping latest timestamp and first display
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

        let entry: HistoryLine = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        let sid = match entry.session_id {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };

        let ts = to_epoch_secs(entry.timestamp.unwrap_or(0.0));
        let display = entry.display.unwrap_or_default();
        let project = entry.project.unwrap_or_default();

        sessions
            .entry(sid)
            .and_modify(|(_, _, existing_ts)| {
                if ts > *existing_ts {
                    *existing_ts = ts;
                }
            })
            .or_insert((display, project, ts));
    }

    sessions
}

/// Pull the launch cwd and a first-prompt preview out of a transcript's head.
/// Bounded to the first lines so multi-MB sessions stay cheap to scan.
fn read_transcript_head(path: &Path) -> (Option<String>, Option<String>) {
    const MAX_HEAD_LINES: usize = 120;

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (None, None),
    };
    let reader = std::io::BufReader::new(file);

    let mut cwd: Option<String> = None;
    let mut display: Option<String> = None;

    for line in reader.lines().take(MAX_HEAD_LINES) {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if cwd.is_none() {
            if let Some(c) = v.get("cwd").and_then(|c| c.as_str()) {
                if !c.is_empty() {
                    cwd = Some(c.to_string());
                }
            }
        }

        if display.is_none()
            && v.get("type").and_then(|t| t.as_str()) == Some("user")
            && !v.get("isMeta").and_then(|m| m.as_bool()).unwrap_or(false)
            && !v.get("isSidechain").and_then(|m| m.as_bool()).unwrap_or(false)
        {
            if let Some(content) = v.get("message").and_then(|m| m.get("content")) {
                let text = match content {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Array(arr) => arr
                        .iter()
                        .filter_map(|item| {
                            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                item.get("text").and_then(|t| t.as_str()).map(str::to_string)
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" "),
                    _ => String::new(),
                };
                let text = text.trim();
                // Skip command wrappers / reminders; wait for a real prompt.
                if !text.is_empty() && !text.starts_with('<') {
                    let mut preview: String =
                        text.chars().take(100).collect::<String>().replace('\n', " ");
                    if text.chars().count() > 100 {
                        preview.push('…');
                    }
                    display = Some(preview);
                }
            }
        }

        if cwd.is_some() && display.is_some() {
            break;
        }
    }

    (cwd, display)
}

/// Every session transcript under ~/.claude/projects/. Only `*.jsonl` files
/// directly inside a project directory are sessions — deeper files
/// (`<sid>/subagents/…`, `tool-results/…`) are plumbing.
fn scan_disk(history: &HashMap<String, (String, String, f64)>) -> Vec<SessionInfo> {
    let mut out = Vec::new();

    let projects = match std::fs::read_dir(claude_paths::projects_dir()) {
        Ok(p) => p,
        Err(_) => return out,
    };

    for project_entry in projects.flatten() {
        let project_dir = project_entry.path();
        if !project_dir.is_dir() {
            continue;
        }
        let files = match std::fs::read_dir(&project_dir) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for file_entry in files.flatten() {
            let path = file_entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let session_id = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };

            // Last activity = file mtime; cheaper than parsing the tail and
            // directly comparable to history timestamps.
            let timestamp = file_entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0);

            let hist = history.get(&session_id);
            let (cwd, first_prompt) = read_transcript_head(&path);

            // The transcript's own cwd is authoritative: history's project
            // string can differ in drive-letter case, and resuming with that
            // variant makes the CLI encode a directory that misses this very
            // file ("No conversation found …").
            let project = cwd
                .or_else(|| hist.map(|(_, p, _)| p.clone()))
                .unwrap_or_default();

            let display = hist
                .map(|(d, _, _)| d.clone())
                .filter(|d| !d.is_empty())
                .or(first_prompt)
                .unwrap_or_else(|| "(no prompt recorded)".to_string());

            out.push(SessionInfo {
                session_id,
                display,
                project,
                timestamp,
                has_file: true,
            });
        }
    }

    out
}

/// All known sessions, newest first: everything on disk, plus history rows
/// whose transcript is gone (has_file=false — listed, but not resumable).
fn scan_sessions() -> Result<Vec<SessionInfo>, String> {
    let history = scan_history();
    let mut result = scan_disk(&history);

    let on_disk: std::collections::HashSet<String> =
        result.iter().map(|s| s.session_id.clone()).collect();

    for (sid, (display, project, ts)) in &history {
        if on_disk.contains(sid) {
            continue;
        }
        // scan_disk enumerated every transcript that exists, so a miss here
        // means the file is gone (the CLI's cleanupPeriodDays deletion).
        result.push(SessionInfo {
            session_id: sid.clone(),
            display: display.clone(),
            project: project.clone(),
            timestamp: *ts,
            has_file: false,
        });
    }

    result.sort_by(|a, b| {
        b.timestamp
            .partial_cmp(&a.timestamp)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(result)
}

#[tauri::command]
pub async fn session_scan_all() -> Result<Vec<SessionInfo>, String> {
    scan_sessions()
}

#[tauri::command]
pub async fn session_list_recent() -> Result<Vec<SessionInfo>, String> {
    let mut sessions = scan_sessions()?;
    // Only return sessions that have existing files, limit to 50
    sessions.retain(|s| s.has_file);
    sessions.truncate(50);
    Ok(sessions)
}

#[tauri::command]
pub async fn session_debug_history() -> Result<String, String> {
    let sessions = scan_sessions()?;
    let with_file = sessions.iter().filter(|s| s.has_file).count();

    let mut output = format!(
        "Projects dir: {}\nHistory file: {}\nSessions known: {} ({} on disk, {} history-only / file gone)\n\n",
        claude_paths::projects_dir().display(),
        claude_paths::history_jsonl_path().display(),
        sessions.len(),
        with_file,
        sessions.len() - with_file,
    );

    for (i, session) in sessions.iter().enumerate() {
        output.push_str(&format!(
            "{}. [{}] {} - {} (file: {})\n",
            i + 1,
            session.session_id,
            session.display,
            session.project,
            if session.has_file { "exists" } else { "missing" }
        ));
    }

    Ok(output)
}

/// Check whether a session's JSONL file still exists on disk.
/// Used by the frontend to drop stale session ids at restore time.
#[tauri::command]
pub fn session_exists(project_path: String, session_id: String) -> bool {
    if session_id.is_empty() {
        return false;
    }
    let resolved = claude_paths::resolve_work_dir(&project_path);
    claude_paths::session_file_path(&resolved, &session_id).exists()
}
