//! MCP for Antigravity panels.
//!
//! agy 1.2.15 loads MCP servers only from its global `~/.gemini/config/mcp_config.json`
//! (or plugins). Everything here is an explicit user action from Settings:
//! servers are added and removed with agy's own `agy mcp add|remove`, and the
//! only other file touched is the `permissions.allow` list in agy's settings,
//! and only for Tessera's own three panel tools.
use super::executable;
use crate::panelbus::bridge;
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const PANEL_TOOLS: [&str; 3] = ["list_panels", "send_to_panel", "read_panel"];

/// Stable and Preview register separately, each pointing at its own executable.
pub fn panel_server_name() -> &'static str {
    if cfg!(feature = "preview") {
        "tessera-preview-panels"
    } else {
        "tessera-panels"
    }
}

/// Headless agy auto-denies an MCP call unless this exact `mcp(server/tool)` rule exists.
pub fn panel_rules() -> Vec<String> {
    PANEL_TOOLS.iter().map(|tool| format!("mcp({}/{tool})", panel_server_name())).collect()
}

fn gemini_dir() -> Result<PathBuf, String> {
    dirs::home_dir().map(|home| home.join(".gemini")).ok_or_else(|| "No home directory.".into())
}
fn read_json(path: &std::path::Path) -> Value {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes)).ok())
        .unwrap_or(Value::Null)
}

/// What this panel's agy process (and, through it, the bridge) needs to reach the bus as itself.
pub fn panel_env(app: &AppHandle, id: &str) -> Vec<(String, String)> {
    let Some(bus) = app.try_state::<crate::panelbus::PanelBus>() else {
        return vec![];
    };
    match bus.port.filter(|_| bus.is_enabled()) {
        Some(port) => vec![
            (bridge::URL_ENV.into(), format!("http://127.0.0.1:{port}/mcp/{id}")),
            (bridge::TOKEN_ENV.into(), bus.token_for(id)),
        ],
        None => vec![],
    }
}

/// `agy mcp add` arguments for one server in Claude's `mcpServers` shape
/// (also what Tessera's MCP manager produces).
pub fn add_args(name: &str, server: &Value) -> Result<Vec<String>, String> {
    if name.is_empty() || name.starts_with('-') || !name.chars().all(|c| c.is_ascii_alphanumeric() || "_-.".contains(c)) {
        return Err(format!("\"{name}\" is not a usable server name for agy (letters, digits, - _ . only)."));
    }
    let mut args: Vec<String> = vec!["mcp".into(), "add".into()];
    if server["type"] == "sse" {
        return Err("uses the legacy SSE transport, which agy does not support. Use the server's Streamable HTTP endpoint, or run it through a stdio bridge such as mcp-remote.".into());
    }
    if let Some(url) = server["url"].as_str().filter(|u| !u.trim().is_empty()) {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("has a URL that is not http(s).".into());
        }
        for (key, value) in server["headers"].as_object().into_iter().flatten() {
            args.extend(["--header".into(), format!("{key}: {}", value.as_str().unwrap_or_default())]);
        }
        args.extend(["--type".into(), "http".into(), name.into(), url.into()]);
        return Ok(args);
    }
    let command = server["command"].as_str().filter(|c| !c.trim().is_empty()).ok_or("has neither a command nor a URL.")?;
    for (key, value) in server["env"].as_object().into_iter().flatten() {
        args.extend(["--env".into(), format!("{key}={}", value.as_str().unwrap_or_default())]);
    }
    // `--` so a command or argument starting with '-' is not read as an agy flag.
    args.extend([name.into(), "--".into(), command.into()]);
    args.extend(server["args"].as_array().into_iter().flatten().filter_map(|a| a.as_str().map(String::from)));
    Ok(args)
}

/// Add or remove rules in a settings document, leaving everything else as it was.
pub fn with_rules(mut settings: Value, rules: &[String], allow: bool) -> Value {
    if !settings.is_object() {
        settings = json!({});
    }
    let mut list: Vec<Value> = settings["permissions"]["allow"].as_array().cloned().unwrap_or_default();
    list.retain(|rule| !rules.iter().any(|ours| rule == ours));
    if allow {
        list.extend(rules.iter().map(|rule| json!(rule)));
    }
    if list.is_empty() && settings["permissions"].is_null() {
        return settings;
    }
    if !settings["permissions"].is_object() {
        settings["permissions"] = json!({});
    }
    settings["permissions"]["allow"] = Value::Array(list);
    settings
}

fn set_panel_rules(allow: bool) -> Result<(), String> {
    let path = gemini_dir()?.join("antigravity-cli").join("settings.json");
    // Read and write back at once: agy edits this file too (for example when you approve a command).
    let current = read_json(&path);
    let updated = with_rules(current.clone(), &panel_rules(), allow);
    if updated == current {
        return Ok(());
    }
    let temporary = path.with_extension("json.tessera-tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(&updated).map_err(|e| e.to_string())?)
        .and_then(|_| std::fs::rename(&temporary, &path))
        .map_err(|e| format!("Cannot update agy's settings.json: {e}"))
}

/// Servers the user already has elsewhere, in Claude's shape. Tessera's own list wins on a name clash.
fn candidates(db: &crate::db::Database) -> Vec<(String, &'static str, Value)> {
    let mut found: Vec<(String, &'static str, Value)> = crate::mcp::config::enabled_servers_json(db)
        .unwrap_or_default()
        .into_iter()
        .map(|(name, server)| (name, "Tessera MCP manager", server))
        .collect();
    let claude = dirs::home_dir().map(|home| read_json(&home.join(".claude.json"))).unwrap_or(Value::Null);
    for (name, server) in claude["mcpServers"].as_object().cloned().unwrap_or_else(Map::new) {
        if !found.iter().any(|(known, _, _)| *known == name) {
            found.push((name, "Claude Code", server));
        }
    }
    found
}

#[tauri::command]
pub async fn antigravity_mcp_status(db: tauri::State<'_, crate::db::Database>) -> Result<Value, String> {
    let dir = gemini_dir()?;
    let configured = read_json(&dir.join("config").join("mcp_config.json"))["mcpServers"].as_object().cloned().unwrap_or_default();
    let settings = read_json(&dir.join("antigravity-cli").join("settings.json"));
    let allowed: Vec<&str> = settings["permissions"]["allow"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let panel = configured.get(panel_server_name());
    let servers: Vec<Value> = configured
        .iter()
        .map(|(name, server)| json!({
            "name": name,
            "target": server["url"].as_str().or(server["serverUrl"].as_str()).or(server["command"].as_str()).unwrap_or(""),
            "disabled": server["disabled"] == true,
            "tessera": name == panel_server_name(),
        }))
        .collect();
    let candidates: Vec<Value> = candidates(&db)
        .into_iter()
        .map(|(name, source, server)| json!({
            "name": name,
            "source": source,
            "target": server["url"].as_str().or(server["command"].as_str()).unwrap_or(""),
            "problem": add_args(&name, &server).err(),
            "added": configured.contains_key(&name),
        }))
        .collect();
    Ok(json!({
        "servers": servers,
        "candidates": candidates,
        "panelTools": {
            "name": panel_server_name(),
            "registered": panel.is_some(),
            // An entry left by another install (or an older location) starts the wrong executable.
            "current": panel.is_some_and(|p| p["command"].as_str().is_some_and(|c| std::path::Path::new(c) == exe)),
            "allowedInChat": panel_rules().iter().all(|rule| allowed.contains(&rule.as_str())),
            "rules": panel_rules(),
        },
    }))
}

async fn agy(executable_path: &str, args: Vec<String>) -> Result<String, String> {
    let executable = executable::resolve(executable_path)?;
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    super::run(&executable, &args, 30).await
}

/// Register (or remove) Tessera's panel tools in agy, and optionally the rules
/// that let chat panels call them without a prompt they could never show.
#[tauri::command]
pub async fn antigravity_mcp_panel_tools(executable_path: String, enable: bool, allow_in_chat: bool) -> Result<(), String> {
    if enable {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let server = json!({"command": exe.to_string_lossy(), "args": [bridge::FLAG]});
        agy(&executable_path, add_args(panel_server_name(), &server)?).await?;
    } else {
        // Removing something that is not there is not an error worth showing.
        let _ = agy(&executable_path, vec!["mcp".into(), "remove".into(), panel_server_name().into()]).await;
    }
    set_panel_rules(enable && allow_in_chat)
}

#[tauri::command]
pub async fn antigravity_mcp_import(executable_path: String, name: String, db: tauri::State<'_, crate::db::Database>) -> Result<(), String> {
    let (_, _, server) = candidates(&db).into_iter().find(|(known, _, _)| *known == name).ok_or("That MCP server is no longer configured.")?;
    let args = add_args(&name, &server).map_err(|problem| format!("\"{name}\" {problem}"))?;
    agy(&executable_path, args).await.map(|_| ())
}

#[tauri::command]
pub async fn antigravity_mcp_remove(executable_path: String, name: String) -> Result<(), String> {
    if name.starts_with('-') {
        return Err("Invalid server name.".into());
    }
    agy(&executable_path, vec!["mcp".into(), "remove".into(), name]).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_agy_mcp_add_commands_from_existing_definitions() {
        // A stdio server exactly as Claude Code stores it.
        let stdio = json!({"type":"stdio","command":"C:\\tools\\.venv\\Scripts\\python.exe","args":["C:\\tools\\mcp_server.py","--verbose"],"env":{"API_KEY":"k=v"}});
        assert_eq!(add_args("desktop-control", &stdio).unwrap(),
            ["mcp", "add", "--env", "API_KEY=k=v", "desktop-control", "--", "C:\\tools\\.venv\\Scripts\\python.exe", "C:\\tools\\mcp_server.py", "--verbose"]);
        let http = json!({"type":"http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer T"}});
        assert_eq!(add_args("remote", &http).unwrap(), ["mcp", "add", "--header", "Authorization: Bearer T", "--type", "http", "remote", "https://mcp.example.com/mcp"]);
        // The bridge entry: a flag-like argument must stay an argument of the command.
        let bridge = json!({"command":"C:\\Apps\\Tessera\\Tessera.exe","args":[bridge::FLAG]});
        assert_eq!(add_args("tessera-panels", &bridge).unwrap(), ["mcp", "add", "tessera-panels", "--", "C:\\Apps\\Tessera\\Tessera.exe", "--panel-mcp-bridge"]);
        assert!(add_args("old", &json!({"type":"sse","url":"https://x/sse"})).unwrap_err().contains("legacy SSE"));
        assert!(add_args("--header", &stdio).is_err());
        assert!(add_args("bad name", &stdio).is_err());
        assert!(add_args("empty", &json!({})).is_err());
        assert!(add_args("file", &json!({"url":"file:///etc/passwd"})).is_err());
    }

    #[test]
    fn allow_rules_are_added_and_removed_without_touching_the_users_own() {
        let rules = panel_rules();
        assert_eq!(rules[1], format!("mcp({}/send_to_panel)", panel_server_name()));
        let mine = json!({"model":"Gemini 3.8 Flash (High)","permissions":{"allow":["command(git status)"],"deny":["command(rm)"]},"trustedWorkspaces":["C:\\Users\\me"]});
        let allowed = with_rules(mine.clone(), &rules, true);
        assert_eq!(allowed["permissions"]["allow"].as_array().unwrap().len(), 4);
        assert_eq!(allowed["permissions"]["allow"][0], "command(git status)");
        assert_eq!(allowed["permissions"]["deny"], mine["permissions"]["deny"]);
        assert_eq!(allowed["trustedWorkspaces"], mine["trustedWorkspaces"]);
        // Idempotent, and removal restores the original document exactly.
        assert_eq!(with_rules(allowed.clone(), &rules, true), allowed);
        assert_eq!(with_rules(allowed, &rules, false), mine);
        // A missing or empty settings file gains only what is needed, and nothing when removing.
        assert_eq!(with_rules(Value::Null, &rules, true)["permissions"]["allow"].as_array().unwrap().len(), 3);
        assert_eq!(with_rules(json!({"model":"m"}), &rules, false), json!({"model":"m"}));
    }
}
