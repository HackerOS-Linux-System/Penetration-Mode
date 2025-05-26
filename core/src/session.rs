use rusqlite::{Connection, Result};

pub fn init_db(conn: &Connection) {
    conn.execute(
        "CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            profile TEXT NOT NULL,
            command TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )",
        (),
    )
    .unwrap();
}

pub fn save_session(conn: &Connection, id: &str, profile: &str, command: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sessions (id, profile, command) VALUES (?1, ?2, ?3)",
        (&id, &profile, &command),
    )?;
    Ok(())
}
