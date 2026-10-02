//! Private Claude config homes for gateway-routed panels.
//!
//! `/model` inside the CLI does not just switch the running session: it writes
//! the pick to the user's settings as the default for every new session. A
//! panel routed to OpenRouter that ran `/model` therefore left
//! `"model": "openrouter/free"` in the shared ~/.claude/settings.json, and
//! every other panel — and plain `claude` in a terminal — started defaulting to
//! a model that only exists behind that gateway.
//!
//! Routed panels get their own CLAUDE_CONFIG_DIR instead, seeded once from the
//! user's real config so the CLI skips onboarding and the trust prompt. The
//! readers in `claude_paths` walk these homes too, so routed sessions still
//! show up in the session list, history and usage totals.

use crate::util::claude_paths;
use serde_json::{json, Value};
use std::path::Path;

/// Fields worth carrying into a routed home: enough for the CLI to start
/// without re-running onboarding, and nothing about billing or credentials.
const SEEDED_CONFIG_KEYS: &[&str] = &[
    "hasCompletedOnboarding",
    "theme",
    "installMethod",
    "autoUpdates",
    "autoUpdaterStatus",
    "userID",
    "firstStartTime",
    "editorMode",
    "preferredNotifChannel",
];

fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Create (once) and return the config home for `key`, a gateway identifier
/// such as "openrouter" or "ollama". `model` becomes the home's default model
/// so the CLI's model picker opens on the routed model rather than an
/// Anthropic alias; `cwd` pre-accepts the trust prompt for the panel's folder.
#[tauri::command]
pub fn claude_routed_config_dir(
    key: String,
    model: Option<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let dir = claude_paths::routed_home(&key);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;

    let shared_home = claude_paths::claude_home();

    // settings.json: the user's own defaults (theme, permissions, hooks) minus
    // the model, which is the whole point of the split.
    let settings_path = dir.join("settings.json");
    if !settings_path.exists() {
        let mut settings = read_json(&shared_home.join("settings.json"))
            .filter(|v| v.is_object())
            .unwrap_or_else(|| json!({}));
        if let Some(map) = settings.as_object_mut() {
            match model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
                Some(m) => {
                    map.insert("model".into(), Value::String(m.to_string()));
                }
                None => {
                    map.remove("model");
                }
            }
        }
        write_json(&settings_path, &settings)?;
    }

    // .claude.json: onboarding state, plus the trust flag for this folder so
    // the panel does not open on "Do you trust the files in this folder?".
    let config_path = dir.join(".claude.json");
    let mut config = read_json(&config_path)
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({ "hasCompletedOnboarding": true }));
    let shared_config = read_json(&shared_home.parent().map(|p| p.join(".claude.json")).unwrap_or_default());
    if let Some(map) = config.as_object_mut() {
        if let Some(shared) = shared_config.as_ref().and_then(|v| v.as_object()) {
            for key in SEEDED_CONFIG_KEYS {
                if !map.contains_key(*key) {
                    if let Some(value) = shared.get(*key) {
                        map.insert((*key).to_string(), value.clone());
                    }
                }
            }
        }
        map.entry("hasCompletedOnboarding").or_insert(Value::Bool(true));

        if let Some(cwd) = cwd.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            let cwd = claude_paths::resolve_work_dir(cwd);
            let projects = map
                .entry("projects")
                .or_insert_with(|| json!({}))
                .as_object_mut();
            if let Some(projects) = projects {
                let entry = projects.entry(cwd).or_insert_with(|| json!({}));
                if let Some(entry) = entry.as_object_mut() {
                    entry.insert("hasTrustDialogAccepted".into(), Value::Bool(true));
                    entry.entry("allowedTools").or_insert_with(|| json!([]));
                    entry.entry("history").or_insert_with(|| json!([]));
                }
            }
        }
    }
    write_json(&config_path, &config)?;

    Ok(dir.to_string_lossy().to_string())
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

#[cfg(test)]
mod tests {
    #[test]
    fn keys_are_path_safe() {
        // Custom gateways are keyed by their URL, which is full of separators.
        let dir = super::claude_paths::routed_home("https://my.host:8080/v1");
        let name = dir.file_name().unwrap().to_string_lossy().to_string();
        assert!(!name.contains('/') && !name.contains(':'));
        assert_eq!(dir.parent().unwrap().file_name().unwrap(), "claude-config");
    }
}
