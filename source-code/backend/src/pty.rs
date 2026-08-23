use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Window};

use crate::blackarch::CONTAINER_NAME;

/// Runda 8: terminal obsługuje teraz wiele równoległych sesji (taby) —
/// wcześniej był dokładnie jeden globalny `Option<PtySession>`, więc
/// otwarcie drugiego taba po prostu ubijało pierwszy. Każda sesja ma
/// własny `session_id` nadawany przez backend przy starcie; frontend
/// (`TerminalTabs.tsx`) trzyma set otwartych id i kieruje write/resize/stop
/// do właściwej sesji po tym id. Zdarzenia (`pty://output`, `pty://closed`)
/// niosą teraz `session_id` w payloadzie, żeby każdy tab-komponent mógł
/// zignorować zdarzenia nie swoich sesji zamiast dostawać cudzy output.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

static SESSIONS: Lazy<Mutex<HashMap<String, PtySession>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize, Clone)]
struct PtyOutputEvent {
    session_id: String,
    chunk: String,
}

#[derive(Serialize, Clone)]
struct PtyClosedEvent {
    session_id: String,
}

#[tauri::command]
pub fn pty_start(window: Window, label: Option<String>) -> Result<String, String> {
    let operator = crate::auth::current_username();
    let session_id = format!("term-{}", NEXT_ID.fetch_add(1, Ordering::SeqCst));
    let label = label.unwrap_or_else(|| "bash".to_string());

    let pty_system = native_pty_system();
    let (rows, cols) = (32u16, 100u16);
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Nie udało się otworzyć PTY: {e}"))?;

    let mut cmd = CommandBuilder::new("podman");
    cmd.args(["exec", "-it", CONTAINER_NAME, "bash"]);

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Nie udało się uruchomić `podman exec`: {e}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Nie udało się sklonować readera PTY: {e}"))?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    SESSIONS.lock().unwrap().insert(session_id.clone(), PtySession { master: pair.master, writer });

    // Runda 10: rejestracja w rejestrze współdzielonych sesji (widok Team
    // / podgląd na żywo przez Lead) + opcjonalne nagrywanie asciinema —
    // patrz session_share.rs. Oba są no-op-bezpieczne przy błędach zapisu
    // na dysk (nigdy nie blokują/wywalają startu terminala).
    crate::session_share::register_session(&session_id, &operator, &label);
    if crate::session_share::recording_enabled() {
        crate::session_share::start_recording(&session_id, &operator, cols, rows);
    }

    crate::audit::log_event(
        "terminal.session_start",
        &operator,
        serde_json::json!({ "container": CONTAINER_NAME, "session_id": session_id, "label": label }),
    );

    let win = window.clone();
    let operator_for_thread = operator.clone();
    let session_id_for_thread = session_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    crate::session_share::append_live_tail(&session_id_for_thread, &chunk);
                    crate::session_share::append_recording(&session_id_for_thread, &chunk);
                    let evt = PtyOutputEvent { session_id: session_id_for_thread.clone(), chunk };
                    if win.emit("pty://output", evt).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = child.wait();
        SESSIONS.lock().unwrap().remove(&session_id_for_thread);
        crate::session_share::unregister_session(&session_id_for_thread);
        crate::session_share::stop_recording(&session_id_for_thread);
        let _ = win.emit("pty://closed", PtyClosedEvent { session_id: session_id_for_thread.clone() });
        crate::audit::log_event(
            "terminal.session_end",
            &operator_for_thread,
            serde_json::json!({ "container": CONTAINER_NAME, "session_id": session_id_for_thread }),
        );
    });

    Ok(session_id)
}

#[tauri::command]
pub fn pty_write(session_id: String, data: String) -> Result<(), String> {
    let mut guard = SESSIONS.lock().unwrap();
    let session = guard.get_mut(&session_id).ok_or("Brak aktywnej sesji terminala o tym id.")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(session_id: String, rows: u16, cols: u16) -> Result<(), String> {
    let guard = SESSIONS.lock().unwrap();
    let session = guard.get(&session_id).ok_or("Brak aktywnej sesji terminala o tym id.")?;
    session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_stop(session_id: String) {
    if let Some(session) = SESSIONS.lock().unwrap().remove(&session_id) {
        drop(session);
    }
}

/// Zamyka wszystkie otwarte sesje terminala naraz — używane przy
/// wylogowaniu, żeby nie zostawiać osieroconych `podman exec` w tle po
/// stronie kontenera dla operatora, który już się wylogował.
#[tauri::command]
pub fn pty_stop_all() {
    let mut guard = SESSIONS.lock().unwrap();
    guard.clear();
}
