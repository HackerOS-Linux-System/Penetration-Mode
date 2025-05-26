use rusqlite::{Connection, Result};

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            profile TEXT NOT NULL,
            command TEXT NOT NULL,
            priority INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT NOT NULL
        )",
        (),
    )?;
    Ok(())
}

pub fn save_session(conn: &Connection, id: &str, profile: &str, command: &str, priority: u8) -> Result<()> {
    conn.execute(
        "INSERT INTO sessions (id, profile, command, priority, status) VALUES (?1, ?2, ?3, ?4, ?5)",
        (id, profile, command, priority, "Running"),
    )?;
    Ok(())
}
