//! Host-rendered terminal snapshots and human input to existing local PTYs.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSnapshot {
    kind: String,
    cols: u16,
    rows: u16,
    data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    windows_pty: Option<Value>,
}

impl TerminalSnapshot {
    fn validate(&self) -> Result<(), String> {
        if self.kind != "terminal"
            || self.cols < 2
            || self.rows == 0
            || self.cols > 4096
            || self.rows > 4096
        {
            return Err("Invalid terminal snapshot geometry".into());
        }
        let size = serde_json::to_vec(self).map_err(|e| e.to_string())?.len();
        if size > 800 * 1024 {
            return Err("Terminal snapshot exceeds the LAN frame budget".into());
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct TerminalRequests {
    pending: Mutex<HashMap<String, oneshot::Sender<Result<TerminalSnapshot, String>>>>,
}

pub async fn read_local(app: &AppHandle, panel_id: &str) -> Result<Value, String> {
    let panel = app
        .state::<crate::panelbus::PanelBus>()
        .local_panels()
        .into_iter()
        .find(|p| p.id == panel_id)
        .ok_or("Local panel is no longer open")?;
    if panel.kind != "terminal" {
        return Err("This panel is not a terminal".into());
    }
    let input_session = crate::pty::manager::input_session(&app.state(), panel_id);
    let state = app.state::<TerminalRequests>();
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state.pending.lock().unwrap();
        if pending.len() >= 64 {
            return Err("Too many pending terminal reads".into());
        }
        pending.insert(request_id.clone(), tx);
    }
    let result = async {
        app.emit(
            "lan-terminal-read",
            serde_json::json!({"requestId": request_id, "panelId": panel_id}),
        )
        .map_err(|e| e.to_string())?;
        let snapshot = tokio::time::timeout(Duration::from_secs(5), rx)
            .await
            .map_err(|_| "Host terminal renderer did not respond".to_string())?
            .map_err(|_| "Host terminal renderer disconnected".to_string())??;
        snapshot.validate()?;
        // Never attach a replacement PTY's token to an in-flight old screen.
        if crate::pty::manager::input_session(&app.state(), panel_id) != input_session {
            return Err("Host terminal changed while reading its screen".into());
        }
        let mut value = serde_json::to_value(snapshot).map_err(|e| e.to_string())?;
        value["inputSession"] = serde_json::to_value(input_session).map_err(|e| e.to_string())?;
        Ok(value)
    }
    .await;
    state.pending.lock().unwrap().remove(&request_id);
    result
}

pub fn validate_input(data: &str) -> Result<(), String> {
    if data.is_empty() || data.len() > super::protocol::MAX_MESSAGE_BYTES {
        return Err("Terminal input must contain between 1 byte and 64 KiB".into());
    }
    Ok(())
}

/// Explicit human terminal control. Do not expose this through panel-bus MCP:
/// agent messages still cannot answer approval prompts or send control keys.
pub fn write_local(app: &AppHandle, panel_id: &str, session: &str, data: &str) -> Result<Value, String> {
    validate_input(data)?;
    let panel = app.state::<crate::panelbus::PanelBus>().local_panels()
        .into_iter().find(|p| p.id == panel_id).ok_or("Local panel is no longer open")?;
    if panel.kind != "terminal" || panel.remote_device_id.is_some() {
        return Err("Direct input is only available for a local terminal".into());
    }
    crate::pty::manager::write_to_session(&app.state(), panel_id, session, data)?;
    Ok(serde_json::json!({"delivered": true}))
}

#[tauri::command]
pub fn lan_terminal_snapshot_result(
    request_id: String,
    snapshot: Option<TerminalSnapshot>,
    error: Option<String>,
    state: tauri::State<'_, TerminalRequests>,
) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&request_id) {
        let result = match (snapshot, error) {
            (_, Some(error)) => Err(error),
            (Some(snapshot), None) => snapshot.validate().map(|_| snapshot),
            _ => Err("Host returned no terminal snapshot".into()),
        };
        let _ = tx.send(result);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_input_allows_user_control_keys_but_bounds_bytes() {
        assert!(validate_input("\x1b[A\t\x03\r").is_ok());
        assert!(validate_input("").is_err());
        assert!(validate_input(&"a".repeat(64 * 1024)).is_ok());
        assert!(validate_input(&"漢".repeat(23000)).is_err());
    }
    #[test]
    fn validates_geometry_and_encoded_frame_size() {
        let mut snapshot = TerminalSnapshot {
            kind: "terminal".into(),
            cols: 120,
            rows: 40,
            data: "\u{1b}[31mhello\u{1b}[0m".into(),
            windows_pty: None,
        };
        assert!(snapshot.validate().is_ok());
        snapshot.cols = 0;
        assert!(snapshot.validate().is_err());
        snapshot.cols = 120;
        snapshot.data = "\u{1b}".repeat(150_000); // JSON escaping counts toward the limit.
        assert!(snapshot.validate().is_err());
    }
}
