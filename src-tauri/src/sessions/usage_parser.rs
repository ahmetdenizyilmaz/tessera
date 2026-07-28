use crate::util::claude_paths;
use serde::{Deserialize, Serialize};
use std::io::BufRead;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageInfo {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub total_cost_usd: f64,
    pub message_count: u32,
}

#[derive(Debug, Deserialize)]
struct UsageLine {
    #[serde(rename = "type")]
    msg_type: Option<String>,
    message: Option<UsageMessage>,
}

#[derive(Debug, Deserialize)]
struct UsageMessage {
    usage: Option<TokenUsage>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
}

fn estimate_cost(model: &str, input: u64, output: u64, cache_read: u64, cache_write: u64) -> f64 {
    // Approximate pricing per 1M tokens (as of 2025)
    let (input_price, output_price, cache_read_price, cache_write_price) = if model.contains("opus") {
        (15.0, 75.0, 1.5, 18.75)
    } else if model.contains("haiku") {
        (0.25, 1.25, 0.025, 0.3)
    } else {
        // Default to sonnet pricing
        (3.0, 15.0, 0.3, 3.75)
    };

    let cost = (input as f64 * input_price
        + output as f64 * output_price
        + cache_read as f64 * cache_read_price
        + cache_write as f64 * cache_write_price)
        / 1_000_000.0;

    cost
}

#[tauri::command]
pub async fn session_parse_usage(
    session_id: String,
    project_path: String,
) -> Result<UsageInfo, String> {
    let file_path = claude_paths::session_file_path(&project_path, &session_id);

    if !file_path.exists() {
        return Ok(UsageInfo::default());
    }

    let file = std::fs::File::open(&file_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = std::io::BufReader::new(file);

    let mut info = UsageInfo::default();
    let mut last_model = String::from("sonnet");

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

        let entry: UsageLine = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        if entry.msg_type.as_deref() != Some("assistant") {
            continue;
        }

        if let Some(ref message) = entry.message {
            if let Some(ref model) = message.model {
                last_model = model.clone();
            }

            if let Some(ref usage) = message.usage {
                let input = usage.input_tokens.unwrap_or(0);
                let output = usage.output_tokens.unwrap_or(0);
                let cache_read = usage.cache_read_input_tokens.unwrap_or(0);
                let cache_write = usage.cache_creation_input_tokens.unwrap_or(0);

                info.input_tokens += input;
                info.output_tokens += output;
                info.cache_read_tokens += cache_read;
                info.cache_write_tokens += cache_write;
                info.message_count += 1;
                info.total_cost_usd += estimate_cost(&last_model, input, output, cache_read, cache_write);
            }
        }
    }

    Ok(info)
}

/// Parse a single .jsonl session file and return aggregated UsageInfo.
fn parse_jsonl_file(path: &std::path::Path) -> UsageInfo {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return UsageInfo::default(),
    };
    let reader = std::io::BufReader::new(file);
    let mut info = UsageInfo::default();
    let mut last_model = String::from("sonnet");

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        let entry: UsageLine = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.msg_type.as_deref() != Some("assistant") {
            continue;
        }
        if let Some(ref message) = entry.message {
            if let Some(ref model) = message.model {
                last_model = model.clone();
            }
            if let Some(ref usage) = message.usage {
                let input = usage.input_tokens.unwrap_or(0);
                let output = usage.output_tokens.unwrap_or(0);
                let cache_read = usage.cache_read_input_tokens.unwrap_or(0);
                let cache_write = usage.cache_creation_input_tokens.unwrap_or(0);

                info.input_tokens += input;
                info.output_tokens += output;
                info.cache_read_tokens += cache_read;
                info.cache_write_tokens += cache_write;
                info.message_count += 1;
                info.total_cost_usd += estimate_cost(&last_model, input, output, cache_read, cache_write);
            }
        }
    }
    info
}

/// Scan all session .jsonl files modified in the last N hours and compute total cost.
#[tauri::command]
pub async fn session_parse_recent_usage(hours: u64) -> Result<UsageInfo, String> {
    let projects_dir = claude_paths::projects_dir();
    if !projects_dir.exists() {
        return Ok(UsageInfo::default());
    }

    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(hours * 3600))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    let mut total = UsageInfo::default();

    // Walk projects directory: projects/<encoded-folder>/<sessionId>.jsonl
    if let Ok(project_dirs) = std::fs::read_dir(&projects_dir) {
        for project_entry in project_dirs.flatten() {
            let project_path = project_entry.path();
            if !project_path.is_dir() {
                continue;
            }
            if let Ok(files) = std::fs::read_dir(&project_path) {
                for file_entry in files.flatten() {
                    let file_path = file_entry.path();
                    if file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                        continue;
                    }
                    // Check modification time against cutoff
                    if let Ok(metadata) = std::fs::metadata(&file_path) {
                        if let Ok(modified) = metadata.modified() {
                            if modified < cutoff {
                                continue;
                            }
                        }
                    }
                    let file_info = parse_jsonl_file(&file_path);
                    total.input_tokens += file_info.input_tokens;
                    total.output_tokens += file_info.output_tokens;
                    total.cache_read_tokens += file_info.cache_read_tokens;
                    total.cache_write_tokens += file_info.cache_write_tokens;
                    total.message_count += file_info.message_count;
                    total.total_cost_usd += file_info.total_cost_usd;
                }
            }
        }
    }

    Ok(total)
}
