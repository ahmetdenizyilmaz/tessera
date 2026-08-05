//! Builds the `--mcp-config` file handed to each spawned Claude session.
//!
//! One file per panel, because the panel's own id is baked into the server URL
//! — that is how the bus knows which panel is calling without trusting
//! anything the model can write.
//!
//! A **file**, not an inline JSON string: `find_claude_exe` can resolve to
//! `claude.cmd`, and a `"`-laden argv element passed to a batch file goes
//! through Rust's post-CVE-2024-24576 escaping, which mangles it or refuses
//! outright. A path sidesteps that, and also keeps the bearer token out of the
//! spawn line that `stream/manager.rs` logs to stderr.

use serde_json::json;
use tauri::{AppHandle, Manager};

use super::{PanelBus, SERVER_NAME};
use crate::db::Database;

/// Write the merged config (the user's enabled servers from McpManager, plus
/// this panel's bus endpoint) and return its path. `None` when there is
/// nothing to declare.
pub fn write_for_panel(app: &AppHandle, panel_id: &str) -> Option<String> {
    let mut servers = app
        .try_state::<Database>()
        .and_then(|db| match crate::mcp::config::enabled_servers_json(&db) {
            Ok(s) => Some(s),
            Err(e) => {
                eprintln!("[panelbus] could not read MCP servers from db: {}", e);
                None
            }
        })
        .unwrap_or_default();

    if let Some(bus) = app.try_state::<PanelBus>() {
        if let (true, Some(port)) = (bus.is_enabled(), bus.port) {
            servers.insert(
                SERVER_NAME.to_string(),
                json!({
                    "type": "http",
                    "url": format!("http://127.0.0.1:{}/mcp/{}", port, panel_id),
                    "headers": { "Authorization": format!("Bearer {}", bus.token) },
                }),
            );
        }
    }

    if servers.is_empty() {
        return None;
    }

    let dir = dirs::home_dir()?.join(".claude-gui").join("panel-mcp");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[panelbus] could not create config dir: {}", e);
        return None;
    }
    let path = dir.join(format!("{}.json", sanitize(panel_id)));

    let body = json!({ "mcpServers": servers });
    let text = serde_json::to_string_pretty(&body).ok()?;
    if let Err(e) = std::fs::write(&path, text) {
        eprintln!("[panelbus] could not write {}: {}", path.display(), e);
        return None;
    }
    Some(path.to_string_lossy().to_string())
}

/// Tool names to pre-approve so cross-panel messaging doesn't raise a
/// permission card on every call.
pub fn allowed_tool_pattern() -> String {
    format!("mcp__{}", SERVER_NAME)
}

/// Panel ids are UUIDs today, but plugin-created instances can name themselves,
/// and this value becomes a filename.
fn sanitize(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(64)
        .collect()
}
