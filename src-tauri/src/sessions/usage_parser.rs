use crate::util::claude_paths;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageInfo {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub total_cost_usd: f64,
    pub message_count: u32,
    /// False when no message came from a model with a known list price.
    #[serde(default)]
    pub priced: bool,
    #[serde(default)]
    pub models: Vec<String>,
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
    // Same de-duplication and list prices as the analytics report.
    Ok(tokio::task::spawn_blocking(move || super::usage_report::session_totals(&file_path))
        .await
        .map_err(|e| e.to_string())?)
}

fn parse_jsonl_file(path: &std::path::Path) -> UsageInfo {
    super::usage_report::session_totals(path)
}

/// Scan all session .jsonl files modified in the last N hours and compute total cost.
#[tauri::command]
pub async fn session_parse_recent_usage(hours: u64) -> Result<UsageInfo, String> {
    // Shared home plus routed config homes — a gateway-routed panel's spend
    // belongs in the same totals.
    let projects_dirs: Vec<_> = claude_paths::projects_dirs()
        .into_iter()
        .filter(|p| p.exists())
        .collect();
    if projects_dirs.is_empty() {
        return Ok(UsageInfo::default());
    }

    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(hours * 3600))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    let mut total = UsageInfo::default();

    // Walk projects directory: projects/<encoded-folder>/<sessionId>.jsonl
    let project_dirs = projects_dirs
        .iter()
        .filter_map(|root| std::fs::read_dir(root).ok())
        .flatten()
        .flatten();

    for project_entry in project_dirs {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&project_path) else {
            continue;
        };
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

    Ok(total)
}
