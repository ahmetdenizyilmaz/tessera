use crate::util::claude_paths;
use serde::{Deserialize, Serialize};
use std::io::BufRead;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryChatMessage {
    pub role: String,
    pub content: String,
    pub timestamp: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionLine {
    #[serde(rename = "type")]
    msg_type: Option<String>,
    #[allow(dead_code)]
    role: Option<String>,
    message: Option<MessageContent>,
    timestamp: Option<String>,
    /// CLI-internal lines (slash-command wrappers, caveats, …)
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
    /// Subagent (Task tool) transcript lines
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
}

/// Command/plumbing wrappers that must never render as chat content
const META_CONTENT_PREFIXES: &[&str] = &[
    "<command-name>",
    "<command-message>",
    "<command-args>",
    "<local-command-stdout>",
    "<local-command-caveat>",
    "<local-command-stderr>",
];

#[derive(Debug, Deserialize)]
struct MessageContent {
    #[allow(dead_code)]
    role: Option<String>,
    content: Option<serde_json::Value>,
}

/// Strip system-reminder and task-notification tags from content
fn strip_system_tags(text: &str) -> String {
    let mut result = text.to_string();

    // Remove <system-reminder>...</system-reminder> blocks
    loop {
        if let Some(start) = result.find("<system-reminder>") {
            if let Some(end) = result.find("</system-reminder>") {
                let end = end + "</system-reminder>".len();
                result = format!("{}{}", &result[..start], &result[end..]);
                continue;
            }
        }
        break;
    }

    // Remove <task-notification>...</task-notification> blocks
    loop {
        if let Some(start) = result.find("<task-notification>") {
            if let Some(end) = result.find("</task-notification>") {
                let end = end + "</task-notification>".len();
                result = format!("{}{}", &result[..start], &result[end..]);
                continue;
            }
        }
        break;
    }

    result.trim().to_string()
}

fn extract_text_content(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => strip_system_tags(s),
        serde_json::Value::Array(arr) => {
            let parts: Vec<String> = arr
                .iter()
                .filter_map(|item| {
                    if let Some(obj) = item.as_object() {
                        if obj.get("type").and_then(|t| t.as_str()) == Some("text") {
                            return obj.get("text").and_then(|t| t.as_str()).map(|s| strip_system_tags(s));
                        }
                    }
                    if let Some(s) = item.as_str() {
                        return Some(strip_system_tags(s));
                    }
                    None
                })
                .collect();
            parts.join("\n")
        }
        _ => String::new(),
    }
}

#[tauri::command]
pub async fn session_load_history(
    session_id: String,
    project_path: String,
) -> Result<Vec<HistoryChatMessage>, String> {
    let resolved = claude_paths::resolve_work_dir(&project_path);
    let file_path = claude_paths::session_file_path(&resolved, &session_id);

    if !file_path.exists() {
        return Err(format!("Session file not found: {}", file_path.display()));
    }

    let file = std::fs::File::open(&file_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = std::io::BufReader::new(file);

    let mut messages: Vec<HistoryChatMessage> = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

        let entry: SessionLine = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Real Claude Code session files use "user" and "assistant"
        // (there is no "human" type on disk)
        let msg_type = entry.msg_type.as_deref().unwrap_or("");
        if msg_type != "user" && msg_type != "assistant" {
            continue;
        }

        // Skip CLI-internal and subagent lines — they are plumbing, not chat
        if entry.is_meta.unwrap_or(false) || entry.is_sidechain.unwrap_or(false) {
            continue;
        }

        let role = msg_type.to_string();

        // Try to get content from message.content first
        let content = if let Some(ref message) = entry.message {
            if let Some(ref content_val) = message.content {
                extract_text_content(content_val)
            } else {
                continue;
            }
        } else {
            continue;
        };

        if content.is_empty() {
            continue;
        }

        // Command wrappers sometimes arrive without the isMeta flag
        let trimmed = content.trim_start();
        if META_CONTENT_PREFIXES.iter().any(|p| trimmed.starts_with(p)) {
            continue;
        }

        messages.push(HistoryChatMessage {
            role,
            content,
            timestamp: entry.timestamp,
            session_id: Some(session_id.clone()),
        });
    }

    Ok(messages)
}
