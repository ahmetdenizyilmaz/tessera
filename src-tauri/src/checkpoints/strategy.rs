use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CheckpointStrategy {
    Manual,
    PerPrompt,
    PerToolUse,
    Smart,
}

impl CheckpointStrategy {
    pub fn from_str(s: &str) -> Self {
        match s {
            "manual" => Self::Manual,
            "per_prompt" => Self::PerPrompt,
            "per_tool_use" => Self::PerToolUse,
            "smart" => Self::Smart,
            _ => Self::PerPrompt,
        }
    }

    pub fn to_str(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::PerPrompt => "per_prompt",
            Self::PerToolUse => "per_tool_use",
            Self::Smart => "smart",
        }
    }
}

const MODIFYING_TOOLS: &[&str] = &["Write", "Edit", "Bash", "NotebookEdit"];

#[tauri::command]
pub async fn checkpoint_should_trigger(
    event_type: String,
    tool_name: Option<String>,
    strategy: String,
) -> Result<bool, String> {
    let strat = CheckpointStrategy::from_str(&strategy);
    Ok(match strat {
        CheckpointStrategy::Manual => false,
        CheckpointStrategy::PerPrompt => event_type == "response_complete",
        CheckpointStrategy::PerToolUse => event_type == "tool_use",
        CheckpointStrategy::Smart => {
            if event_type == "tool_use" {
                if let Some(ref name) = tool_name {
                    MODIFYING_TOOLS.iter().any(|t| name.contains(t))
                } else {
                    false
                }
            } else {
                false
            }
        }
    })
}

#[tauri::command]
pub async fn checkpoint_set_strategy(
    strategy: String,
    state: tauri::State<'_, crate::db::Database>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('checkpoint_strategy', ?1, datetime('now'))",
        rusqlite::params![strategy],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn checkpoint_get_strategy(
    state: tauri::State<'_, crate::db::Database>,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM app_settings WHERE key = 'checkpoint_strategy'",
        [],
        |row| row.get::<_, String>(0),
    );
    Ok(result.unwrap_or_else(|_| "per_prompt".to_string()))
}
