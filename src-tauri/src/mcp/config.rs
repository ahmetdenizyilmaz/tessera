use crate::db::Database;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct McpServer {
    pub id: i64,
    pub name: String,
    pub transport: String,
    pub command: String,
    pub args: String,
    pub env: String,
    pub url: String,
    pub scope: String,
    pub is_default: bool,
    pub enabled: bool,
    pub created_at: String,
}

#[tauri::command]
pub async fn mcp_list_servers(
    state: tauri::State<'_, Database>,
) -> Result<Vec<McpServer>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, transport, command, args, env, url, scope, is_default, enabled, created_at FROM mcp_servers ORDER BY is_default DESC, name")
        .map_err(|e| e.to_string())?;
    let servers = stmt
        .query_map([], |row| {
            Ok(McpServer {
                id: row.get(0)?,
                name: row.get(1)?,
                transport: row.get(2)?,
                command: row.get(3)?,
                args: row.get(4)?,
                env: row.get(5)?,
                url: row.get(6)?,
                scope: row.get(7)?,
                is_default: row.get::<_, i64>(8)? != 0,
                enabled: row.get::<_, i64>(9)? != 0,
                created_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(servers)
}

#[tauri::command]
pub async fn mcp_add_server(
    name: String,
    transport: String,
    command: String,
    args: Option<String>,
    env: Option<String>,
    url: Option<String>,
    scope: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO mcp_servers (name, transport, command, args, env, url, scope) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            name,
            transport,
            command,
            args.unwrap_or_else(|| "[]".to_string()),
            env.unwrap_or_else(|| "{}".to_string()),
            url.unwrap_or_default(),
            scope.unwrap_or_else(|| "global".to_string())
        ],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn mcp_update_server(
    id: i64,
    name: Option<String>,
    transport: Option<String>,
    command: Option<String>,
    args: Option<String>,
    env: Option<String>,
    url: Option<String>,
    scope: Option<String>,
    enabled: Option<bool>,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut updates = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(v) = name { updates.push("name = ?"); params.push(Box::new(v)); }
    if let Some(v) = transport { updates.push("transport = ?"); params.push(Box::new(v)); }
    if let Some(v) = command { updates.push("command = ?"); params.push(Box::new(v)); }
    if let Some(v) = args { updates.push("args = ?"); params.push(Box::new(v)); }
    if let Some(v) = env { updates.push("env = ?"); params.push(Box::new(v)); }
    if let Some(v) = url { updates.push("url = ?"); params.push(Box::new(v)); }
    if let Some(v) = scope { updates.push("scope = ?"); params.push(Box::new(v)); }
    if let Some(v) = enabled { updates.push("enabled = ?"); params.push(Box::new(v as i64)); }

    if updates.is_empty() { return Ok(()); }

    params.push(Box::new(id));
    let sql = format!("UPDATE mcp_servers SET {} WHERE id = ?", updates.join(", "));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, param_refs.as_slice()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_remove_server(
    id: i64,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM mcp_servers WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_toggle_server(
    id: i64,
    enabled: bool,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE mcp_servers SET enabled = ?1 WHERE id = ?2",
        rusqlite::params![enabled as i64, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_import_from_claude_desktop() -> Result<Vec<McpServer>, String> {
    // Read Claude Desktop config from standard location
    let config_path = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("Claude")
        .join("claude_desktop_config.json");

    if !config_path.exists() {
        return Err("Claude Desktop config not found".to_string());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    let mcp_servers = config.get("mcpServers")
        .and_then(|v| v.as_object())
        .ok_or("No mcpServers found in config")?;

    let mut servers = Vec::new();
    for (name, server_config) in mcp_servers {
        let command = server_config.get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let args = server_config.get("args")
            .map(|v| v.to_string())
            .unwrap_or_else(|| "[]".to_string());
        let env = server_config.get("env")
            .map(|v| v.to_string())
            .unwrap_or_else(|| "{}".to_string());

        servers.push(McpServer {
            id: 0,
            name: name.clone(),
            transport: "stdio".to_string(),
            command,
            args,
            env,
            url: String::new(),
            scope: "global".to_string(),
            is_default: false,
            enabled: true,
            created_at: String::new(),
        });
    }

    Ok(servers)
}

/// The `mcpServers` entries for every enabled server in the DB, in the shape
/// the Claude CLI expects.
pub fn enabled_servers_json(db: &Database) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT name, transport, command, args, env, url FROM mcp_servers WHERE enabled = 1")
        .map_err(|e| e.to_string())?;

    let servers: Vec<(String, String, String, String, String, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut out = serde_json::Map::new();

    for (name, transport, command, args, env, url) in &servers {
        let mut server_obj = serde_json::Map::new();

        // Remote transports are declared by type + url; only stdio servers
        // carry a command line. Emitting a bare `command` for an http server
        // (the old behaviour) produced an entry the CLI could not connect to.
        match transport.as_str() {
            "sse" | "streamable-http" | "http" => {
                if url.trim().is_empty() {
                    continue;
                }
                let kind = if transport == "sse" { "sse" } else { "http" };
                server_obj.insert("type".to_string(), serde_json::Value::String(kind.into()));
                server_obj.insert("url".to_string(), serde_json::Value::String(url.clone()));
            }
            _ => {
                if command.trim().is_empty() {
                    continue;
                }
                server_obj.insert(
                    "command".to_string(),
                    serde_json::Value::String(command.clone()),
                );
                if let Ok(args_val) = serde_json::from_str::<serde_json::Value>(args) {
                    if args_val.is_array() {
                        server_obj.insert("args".to_string(), args_val);
                    }
                }
            }
        }

        if let Ok(env_val) = serde_json::from_str::<serde_json::Value>(env) {
            if env_val.is_object() && !env_val.as_object().unwrap().is_empty() {
                server_obj.insert("env".to_string(), env_val);
            }
        }

        out.insert(name.clone(), serde_json::Value::Object(server_obj));
    }

    Ok(out)
}

/// Generate MCP config JSON for Claude CLI from enabled servers in DB
pub fn generate_mcp_config(db: &Database) -> Result<Option<String>, String> {
    let servers = enabled_servers_json(db)?;
    if servers.is_empty() {
        return Ok(None);
    }

    let mut mcp_config = serde_json::Map::new();
    mcp_config.insert("mcpServers".to_string(), serde_json::Value::Object(servers));

    let dir = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".claude-gui");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let config_path = dir.join("mcp_config.json");

    let json_str = serde_json::to_string_pretty(&serde_json::Value::Object(mcp_config))
        .map_err(|e| e.to_string())?;
    std::fs::write(&config_path, &json_str).map_err(|e| e.to_string())?;

    Ok(Some(config_path.to_string_lossy().to_string()))
}
