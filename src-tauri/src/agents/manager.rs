use crate::db::Database;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Agent {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub model: String,
    pub tools: String,
    pub mcp_servers: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentRun {
    pub id: i64,
    pub agent_id: i64,
    pub status: String,
    pub input: String,
    pub output: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub token_usage: String,
}

#[tauri::command]
pub async fn agent_list(
    state: tauri::State<'_, Database>,
) -> Result<Vec<Agent>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, description, system_prompt, model, tools, mcp_servers, created_at, updated_at FROM agents ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let agents = stmt
        .query_map([], |row| {
            Ok(Agent {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                system_prompt: row.get(3)?,
                model: row.get(4)?,
                tools: row.get(5)?,
                mcp_servers: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(agents)
}

#[tauri::command]
pub async fn agent_create(
    name: String,
    description: String,
    system_prompt: String,
    model: String,
    tools: Option<String>,
    mcp_servers: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO agents (name, description, system_prompt, model, tools, mcp_servers) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![name, description, system_prompt, model, tools.unwrap_or_else(|| "[]".to_string()), mcp_servers.unwrap_or_else(|| "[]".to_string())],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn agent_update(
    id: i64,
    name: Option<String>,
    description: Option<String>,
    system_prompt: Option<String>,
    model: Option<String>,
    tools: Option<String>,
    mcp_servers: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut updates = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(v) = name { updates.push("name = ?"); params.push(Box::new(v)); }
    if let Some(v) = description { updates.push("description = ?"); params.push(Box::new(v)); }
    if let Some(v) = system_prompt { updates.push("system_prompt = ?"); params.push(Box::new(v)); }
    if let Some(v) = model { updates.push("model = ?"); params.push(Box::new(v)); }
    if let Some(v) = tools { updates.push("tools = ?"); params.push(Box::new(v)); }
    if let Some(v) = mcp_servers { updates.push("mcp_servers = ?"); params.push(Box::new(v)); }

    if updates.is_empty() { return Ok(()); }

    updates.push("updated_at = datetime('now')");
    params.push(Box::new(id));

    let sql = format!("UPDATE agents SET {} WHERE id = ?", updates.join(", "));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, param_refs.as_slice()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn agent_delete(
    id: i64,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM agents WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn agent_list_runs(
    agent_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<Vec<AgentRun>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, agent_id, status, input, output, started_at, completed_at, token_usage FROM agent_runs WHERE agent_id = ?1 ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let runs = stmt
        .query_map(rusqlite::params![agent_id], |row| {
            Ok(AgentRun {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                status: row.get(2)?,
                input: row.get(3)?,
                output: row.get(4)?,
                started_at: row.get(5)?,
                completed_at: row.get(6)?,
                token_usage: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(runs)
}
