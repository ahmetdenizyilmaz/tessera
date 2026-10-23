//! Panel-owned process suspension. Transcripts and session identities are retained.
use std::{collections::HashSet, path::PathBuf, sync::{Mutex, atomic::Ordering}};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct HibernationState {
    sleeping: Mutex<HashSet<String>>,
    gate: tokio::sync::Mutex<()>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPreview {
    pub text: String,
    pub terminal: bool,
    pub font_size: Option<f32>,
    pub font_family: Option<String>,
}

fn preview_path(id: &str) -> Result<PathBuf, String> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| "Invalid panel preview ID")?;
    Ok(crate::app_paths::data_dir().join("panel-previews").join(format!("{id}.json")))
}

fn validate_preview(preview: &PanelPreview) -> Result<(), String> {
    if preview.text.len() > 256 * 1024 || preview.font_family.as_ref().is_some_and(|s| s.len() > 256)
        || preview.font_size.is_some_and(|s| !s.is_finite() || !(8.0..=72.0).contains(&s)) {
        return Err("Panel preview is too large or invalid".into());
    }
    Ok(())
}

pub fn ensure_awake(app: &AppHandle, id: &str) -> Result<(), String> {
    if app.try_state::<HibernationState>().is_some_and(|s| s.sleeping.lock().unwrap().contains(id)) {
        return Err("This panel is hibernating. Use Wake panel in Tessera to resume it.".into());
    }
    Ok(())
}

fn ensure_idle(app: &AppHandle, id: &str) -> Result<(), String> {
    let reported_busy = app.try_state::<crate::panelbus::PanelBus>().is_some_and(|bus|
        bus.with_registry(|r| r.get(id).is_some_and(|p| p.busy || p.awaiting_user)));
    let codex_busy = app.state::<crate::codex::CodexManager>().client(id).is_ok_and(|client|
        client.busy.load(Ordering::Acquire) || !client.requests.lock().unwrap().is_empty());
    if reported_busy || codex_busy || app.state::<crate::stream::manager::StreamJsonManager>().has_pending_turn(id) {
        return Err("This panel is working or waiting for an answer. Finish or stop its turn before hibernating.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn panel_hibernate(id: String, preview_id: String, preview: PanelPreview, app: AppHandle,
    state: tauri::State<'_, HibernationState>) -> Result<(), String> {
    validate_preview(&preview)?;
    let path = preview_path(&preview_id)?;
    let _guard = state.gate.lock().await;
    ensure_idle(&app, &id)?;
    // Persist first: a write failure must leave a live panel untouched.
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, serde_json::to_vec(&preview).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    state.sleeping.lock().unwrap().insert(id.clone());
    let result = async {
        // Each manager owns its child tree, including per-panel MCP children.
        // Closing an app-server alone would leave its terminal client alive.
        crate::pty::manager::pty_kill(id.clone(), app.clone(), app.state()).await?;
        crate::stream::manager::stream_kill(id.clone(), app.clone(), app.state()).await?;
        crate::codex::codex_close(id.clone(), app.state()).await?;
        crate::opencode::opencode_close(id.clone(), app.state()).await?;
        crate::antigravity::antigravity_close(id.clone(), app.state()).await?;
        Ok::<(), String>(())
    }.await;
    if result.is_err() { state.sleeping.lock().unwrap().remove(&id); }
    result
}

#[tauri::command]
pub async fn panel_wake(id: String, state: tauri::State<'_, HibernationState>) -> Result<(), String> {
    let _guard = state.gate.lock().await;
    state.sleeping.lock().unwrap().remove(&id);
    // The renderer reconnects using the saved provider session ID. No prompt is sent.
    Ok(())
}

#[tauri::command]
pub fn panel_hibernation_restore(ids: Vec<String>, state: tauri::State<'_, HibernationState>) {
    state.sleeping.lock().unwrap().extend(ids);
}

#[tauri::command]
pub async fn panel_preview_read(preview_id: String) -> Result<PanelPreview, String> {
    let path = preview_path(&preview_id)?;
    let metadata = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?;
    if metadata.len() > 2 * 1024 * 1024 { return Err("Invalid panel preview".into()); }
    let preview = serde_json::from_slice(&tokio::fs::read(path).await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    validate_preview(&preview)?;
    Ok(preview)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preview_paths_cannot_escape_app_storage() {
        for id in ["../settings", "C:\\Users\\ady\\file", "", "abcd.json"] { assert!(preview_path(id).is_err()); }
        assert!(preview_path(&uuid::Uuid::new_v4().to_string()).unwrap().starts_with(crate::app_paths::data_dir().join("panel-previews")));
    }
    #[test]
    fn previews_are_bounded_and_plain_data() {
        let mut preview = PanelPreview { text: "A conversation".into(), terminal: true, font_size: Some(14.), font_family: None };
        assert!(validate_preview(&preview).is_ok());
        preview.text = "x".repeat(256 * 1024 + 1);
        assert!(validate_preview(&preview).is_err());
        preview.text.clear(); preview.font_size = Some(f32::INFINITY);
        assert!(validate_preview(&preview).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn process_cleanup_releases_owned_mcp_children() {
        use std::{io::{BufRead, BufReader}, os::windows::process::CommandExt, process::{Command, Stdio}, time::Duration};
        // Isolated stand-ins for an agent and its stdio MCP server. Never target
        // any process belonging to the user's running Tessera workspace.
        let mut parent = Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                "$child = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru; [Console]::WriteLine($child.Id); Start-Sleep -Seconds 60"])
            .creation_flags(0x0800_0000).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        struct OwnedTree(u32);
        impl Drop for OwnedTree { fn drop(&mut self) { crate::util::proc::kill_tree(self.0); } }
        let _cleanup = OwnedTree(parent.id());
        let stdout = parent.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || { let _ = tx.send(BufReader::new(stdout).lines().next()); });
        let child_id: u32 = rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap().unwrap().trim().parse().unwrap();
        let child_pid = sysinfo::Pid::from_u32(child_id);
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[child_pid]), true);
        assert!(system.process(child_pid).is_some(), "MCP fixture must start before testing cleanup");
        crate::util::proc::kill_tree(parent.id());
        parent.wait().unwrap();
        for _ in 0..50 {
            system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[child_pid]), true);
            if system.process(child_pid).is_none() { return; }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("Panel cleanup left an owned MCP child alive");
    }
}
