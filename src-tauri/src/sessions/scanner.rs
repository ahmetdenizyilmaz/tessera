use crate::util::claude_paths;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufRead;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub display: String,
    pub project: String,
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

fn scan_history() -> Result<Vec<SessionInfo>, String> {
    let history_path = claude_paths::history_jsonl_path();

    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let file =
        std::fs::File::open(&history_path).map_err(|e| format!("Failed to open history: {}", e))?;
    let reader = std::io::BufReader::new(file);

    // Group by sessionId, keeping latest timestamp and first display
    let mut sessions: HashMap<String, (String, String, f64)> = HashMap::new();

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

        let ts = entry.timestamp.unwrap_or(0.0);
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

    // Convert to SessionInfo and check file existence
    let mut result: Vec<SessionInfo> = sessions
        .into_iter()
        .map(|(session_id, (display, project, timestamp))| {
            let file_path = claude_paths::session_file_path(&project, &session_id);
            let has_file = file_path.exists();

            SessionInfo {
                session_id,
                display,
                project,
                timestamp,
                has_file,
            }
        })
        .collect();

    // Sort by timestamp descending
    result.sort_by(|a, b| b.timestamp.partial_cmp(&a.timestamp).unwrap_or(std::cmp::Ordering::Equal));

    Ok(result)
}

#[tauri::command]
pub async fn session_scan_all() -> Result<Vec<SessionInfo>, String> {
    scan_history()
}

#[tauri::command]
pub async fn session_list_recent() -> Result<Vec<SessionInfo>, String> {
    let mut sessions = scan_history()?;
    // Only return sessions that have existing files, limit to 50
    sessions.retain(|s| s.has_file);
    sessions.truncate(50);
    Ok(sessions)
}

#[tauri::command]
pub async fn session_debug_history() -> Result<String, String> {
    let history_path = claude_paths::history_jsonl_path();

    if !history_path.exists() {
        return Ok(format!(
            "History file not found at: {}",
            history_path.display()
        ));
    }

    let sessions = scan_history()?;

    let mut output = format!(
        "History file: {}\nTotal sessions found: {}\n\n",
        history_path.display(),
        sessions.len()
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
