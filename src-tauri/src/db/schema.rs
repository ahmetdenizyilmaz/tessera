use rusqlite::Connection;

pub fn create_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS mcp_servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            transport TEXT NOT NULL DEFAULT 'stdio',
            command TEXT NOT NULL DEFAULT '',
            args TEXT NOT NULL DEFAULT '[]',
            env TEXT NOT NULL DEFAULT '{}',
            url TEXT NOT NULL DEFAULT '',
            scope TEXT NOT NULL DEFAULT 'global',
            is_default INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            system_prompt TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            tools TEXT NOT NULL DEFAULT '[]',
            mcp_servers TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agent_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            input TEXT NOT NULL DEFAULT '',
            output TEXT NOT NULL DEFAULT '',
            started_at TEXT,
            completed_at TEXT,
            token_usage TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS checkpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instance_id TEXT NOT NULL,
            session_id TEXT NOT NULL DEFAULT '',
            parent_id INTEGER,
            branch_name TEXT NOT NULL DEFAULT 'main',
            label TEXT NOT NULL DEFAULT '',
            messages_snapshot TEXT NOT NULL DEFAULT '[]',
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (parent_id) REFERENCES checkpoints(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS usage_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            project_path TEXT NOT NULL DEFAULT '',
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0.0,
            recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_checkpoints_instance ON checkpoints(instance_id);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_branch ON checkpoints(instance_id, branch_name);
        CREATE INDEX IF NOT EXISTS idx_usage_records_date ON usage_records(recorded_at);
        CREATE INDEX IF NOT EXISTS idx_usage_records_session ON usage_records(session_id);
        CREATE INDEX IF NOT EXISTS idx_usage_records_project ON usage_records(project_path);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id);
        "
    )?;

    // Insert default desktop-control MCP server if not exists
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM mcp_servers WHERE name = 'desktop-control'",
        [],
        |row| row.get(0),
    )?;
    if count == 0 {
        conn.execute(
            "INSERT INTO mcp_servers (name, transport, command, args, is_default, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                "desktop-control",
                "stdio",
                "python",
                r#"["mcp_server.py"]"#,
                1,
                0
            ],
        )?;
    }

    // Insert default agents if none exist
    let agent_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM agents",
        [],
        |row| row.get(0),
    )?;
    if agent_count == 0 {
        conn.execute(
            "INSERT INTO agents (name, description, system_prompt, model) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "Code Reviewer",
                "Reviews code changes and suggests improvements",
                "You are a code reviewer. Analyze the provided code for bugs, performance issues, security vulnerabilities, and style improvements. Be specific and actionable in your feedback.",
                "claude-sonnet-4-6"
            ],
        )?;
        conn.execute(
            "INSERT INTO agents (name, description, system_prompt, model) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "Doc Generator",
                "Generates documentation from codebase",
                "You are a documentation generator. Analyze the provided code and generate clear, comprehensive documentation including function signatures, parameters, return values, and usage examples.",
                "claude-sonnet-4-6"
            ],
        )?;
        conn.execute(
            "INSERT INTO agents (name, description, system_prompt, model) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "Test Writer",
                "Writes tests for specified files",
                "You are a test writer. Analyze the provided code and write comprehensive unit tests. Cover edge cases, error conditions, and normal operation. Use the testing framework already present in the project.",
                "claude-sonnet-4-6"
            ],
        )?;
    }

    Ok(())
}
