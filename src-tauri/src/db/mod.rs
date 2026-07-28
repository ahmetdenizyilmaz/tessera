pub mod schema;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, String> {
        let db_dir = dirs::home_dir()
            .ok_or("Could not find home directory")?
            .join(".claude-gui");

        std::fs::create_dir_all(&db_dir)
            .map_err(|e| format!("Failed to create database directory: {}", e))?;

        let db_path = db_dir.join("claude_gui.db");

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // Enable WAL mode for better concurrency
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("Failed to set pragmas: {}", e))?;

        schema::create_tables(&conn)
            .map_err(|e| format!("Failed to create tables: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}
