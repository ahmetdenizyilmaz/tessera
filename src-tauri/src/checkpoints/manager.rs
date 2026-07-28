use crate::db::Database;
use serde::{Deserialize, Serialize};
use std::io::Read as _;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Checkpoint {
    pub id: i64,
    pub instance_id: String,
    pub session_id: String,
    pub parent_id: Option<i64>,
    pub branch_name: String,
    pub label: String,
    pub messages_snapshot: String,
    pub metadata: String,
    pub created_at: String,
}

fn compress_snapshot(json: &str) -> Vec<u8> {
    zstd::encode_all(json.as_bytes(), 3).unwrap_or_else(|_| json.as_bytes().to_vec())
}

fn decompress_snapshot(data: &[u8]) -> Result<String, String> {
    // Check for zstd magic bytes
    if data.len() >= 4 && data[0] == 0x28 && data[1] == 0xB5 && data[2] == 0x2F && data[3] == 0xFD {
        let mut decoder = zstd::Decoder::new(data).map_err(|e| e.to_string())?;
        let mut result = String::new();
        decoder.read_to_string(&mut result).map_err(|e| e.to_string())?;
        Ok(result)
    } else {
        // Treat as plain UTF-8 text
        String::from_utf8(data.to_vec()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn checkpoint_create(
    instance_id: String,
    session_id: String,
    label: String,
    messages_snapshot: String,
    branch_name: Option<String>,
    parent_id: Option<i64>,
    state: tauri::State<'_, Database>,
) -> Result<i64, String> {
    let compressed = compress_snapshot(&messages_snapshot);
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO checkpoints (instance_id, session_id, label, messages_snapshot, branch_name, parent_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![instance_id, session_id, label, compressed, branch_name.unwrap_or_else(|| "main".to_string()), parent_id],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn checkpoint_list(
    instance_id: String,
    state: tauri::State<'_, Database>,
) -> Result<Vec<Checkpoint>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, instance_id, session_id, parent_id, branch_name, label, messages_snapshot, metadata, created_at FROM checkpoints WHERE instance_id = ?1 ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let checkpoints = stmt
        .query_map(rusqlite::params![instance_id], |row| {
            let snapshot_bytes: Vec<u8> = row.get(6)?;
            let snapshot = decompress_snapshot(&snapshot_bytes).unwrap_or_else(|_| "[]".to_string());
            Ok(Checkpoint {
                id: row.get(0)?,
                instance_id: row.get(1)?,
                session_id: row.get(2)?,
                parent_id: row.get(3)?,
                branch_name: row.get(4)?,
                label: row.get(5)?,
                messages_snapshot: snapshot,
                metadata: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(checkpoints)
}

#[tauri::command]
pub async fn checkpoint_get(
    checkpoint_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<Checkpoint, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, instance_id, session_id, parent_id, branch_name, label, messages_snapshot, metadata, created_at FROM checkpoints WHERE id = ?1",
        rusqlite::params![checkpoint_id],
        |row| {
            let snapshot_bytes: Vec<u8> = row.get(6)?;
            let snapshot = decompress_snapshot(&snapshot_bytes).unwrap_or_else(|_| "[]".to_string());
            Ok(Checkpoint {
                id: row.get(0)?,
                instance_id: row.get(1)?,
                session_id: row.get(2)?,
                parent_id: row.get(3)?,
                branch_name: row.get(4)?,
                label: row.get(5)?,
                messages_snapshot: snapshot,
                metadata: row.get(7)?,
                created_at: row.get(8)?,
            })
        },
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn checkpoint_delete(
    checkpoint_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM checkpoints WHERE id = ?1", rusqlite::params![checkpoint_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn checkpoint_restore(
    checkpoint_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<Checkpoint, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, instance_id, session_id, parent_id, branch_name, label, messages_snapshot, metadata, created_at FROM checkpoints WHERE id = ?1",
        rusqlite::params![checkpoint_id],
        |row| {
            let snapshot_bytes: Vec<u8> = row.get(6)?;
            let snapshot = decompress_snapshot(&snapshot_bytes).unwrap_or_else(|_| "[]".to_string());
            Ok(Checkpoint {
                id: row.get(0)?,
                instance_id: row.get(1)?,
                session_id: row.get(2)?,
                parent_id: row.get(3)?,
                branch_name: row.get(4)?,
                label: row.get(5)?,
                messages_snapshot: snapshot,
                metadata: row.get(7)?,
                created_at: row.get(8)?,
            })
        },
    ).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffResult {
    pub added: Vec<serde_json::Value>,
    pub removed: Vec<serde_json::Value>,
    pub modified: Vec<DiffModified>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffModified {
    pub index: usize,
    pub before: serde_json::Value,
    pub after: serde_json::Value,
}

#[tauri::command]
pub async fn checkpoint_diff(
    id_a: i64,
    id_b: i64,
    state: tauri::State<'_, Database>,
) -> Result<DiffResult, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let get_snapshot = |id: i64| -> Result<Vec<serde_json::Value>, String> {
        let snap_bytes: Vec<u8> = conn.query_row(
            "SELECT messages_snapshot FROM checkpoints WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        let snap = decompress_snapshot(&snap_bytes)?;
        serde_json::from_str(&snap).map_err(|e| e.to_string())
    };

    let msgs_a = get_snapshot(id_a)?;
    let msgs_b = get_snapshot(id_b)?;

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();

    let max_len = msgs_a.len().max(msgs_b.len());
    for i in 0..max_len {
        match (msgs_a.get(i), msgs_b.get(i)) {
            (None, Some(b)) => added.push(b.clone()),
            (Some(a), None) => removed.push(a.clone()),
            (Some(a), Some(b)) if a != b => modified.push(DiffModified {
                index: i,
                before: a.clone(),
                after: b.clone(),
            }),
            _ => {}
        }
    }

    Ok(DiffResult { added, removed, modified })
}

#[tauri::command]
pub async fn checkpoint_branch(
    checkpoint_id: i64,
    new_branch_name: String,
    state: tauri::State<'_, Database>,
) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Read the parent checkpoint's snapshot as raw bytes (compressed)
    let (instance_id, session_id, snapshot_bytes): (String, String, Vec<u8>) = conn.query_row(
        "SELECT instance_id, session_id, messages_snapshot FROM checkpoints WHERE id = ?1",
        rusqlite::params![checkpoint_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|e| e.to_string())?;

    // Insert the branch with the same compressed snapshot data
    conn.execute(
        "INSERT INTO checkpoints (instance_id, session_id, label, messages_snapshot, branch_name, parent_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![instance_id, session_id, format!("Branch: {}", new_branch_name), snapshot_bytes, new_branch_name, checkpoint_id],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn checkpoint_gc(
    state: tauri::State<'_, Database>,
) -> Result<u64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let deleted = conn.execute(
        "DELETE FROM checkpoints WHERE created_at < datetime('now', '-30 days') AND id NOT IN (SELECT DISTINCT parent_id FROM checkpoints WHERE parent_id IS NOT NULL)",
        [],
    ).map_err(|e| e.to_string())?;
    Ok(deleted as u64)
}
