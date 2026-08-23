use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Window};

use crate::presence::shared_dir;

/// Współdzielenie i nagrywanie sesji terminala (Runda 10) — dwie
/// pokrewne funkcje, obie "podpięte pod" ten sam punkt (strumień outputu
/// PTY w `pty.rs`), więc żyją w jednym module:
///
/// 1. **Podgląd na żywo** (Lead ogląda sesję Operatora — mentoring/nadzór).
///    Każda żywa sesja terminala dopisuje swój output do małego,
///    rotującego pliku `live-sessions/<session_id>.log` w katalogu
///    współdzielonym (patrz `presence::shared_dir` — te same ograniczenia
///    dot. widoczności między kontami systemowymi). `watch_session_start`
///    tailuje ten plik dokładnie tym samym wzorcem co audit-tail w
///    `logs.rs` (polling offsetu pliku) — nie wymyślamy nowego
///    mechanizmu dla czegoś strukturalnie identycznego.
/// 2. **Nagrywanie** (asciinema v2 `.cast`) — opt-in przez
///    `terminal_recording_enabled` w Ustawieniach (domyślnie wyłączone:
///    nagrywanie każdej sesji to decyzja prywatności/zgody operatora, nie
///    coś appka powinna robić po cichu). Pliki `.cast` można pobrać i
///    odtworzyć w dowolnym odtwarzaczu asciinema (albo wgrać na
///    asciinema.org) — appka sama nie ma wbudowanego odtwarzacza (patrz
///    limitations w README).
///
/// **Świadomie o zgodzie/transparentności:** obejrzenie cudzej sesji jest
/// samo w sobie zdarzeniem audytowym (`terminal.session_watch_start`) —
/// obserwowany operator może zobaczyć w swoim Activity/Audit logu, że
/// ktoś oglądał jego sesję. To nie jest ukryta inwigilacja: ślad zostaje,
/// tak samo audytowalny jak każda inna akcja w tej appce.

const MAX_LIVE_TAIL_BYTES: u64 = 200_000;

fn live_sessions_dir() -> PathBuf {
    shared_dir().join("live-sessions")
}

fn recordings_dir() -> PathBuf {
    shared_dir().join("recordings")
}

fn live_tail_path(session_id: &str) -> PathBuf {
    live_sessions_dir().join(format!("{session_id}.log"))
}

fn index_path() -> PathBuf {
    live_sessions_dir().join("index.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedSessionInfo {
    pub session_id: String,
    pub operator: String,
    pub label: String,
    pub started_at: String,
}

fn load_index() -> HashMap<String, SharedSessionInfo> {
    std::fs::read_to_string(index_path()).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

fn save_index(map: &HashMap<String, SharedSessionInfo>) {
    let path = index_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(map) {
        let _ = std::fs::write(&path, bytes);
    }
}

/// Wołane przez `pty.rs` przy starcie każdej sesji terminala — rejestruje
/// ją jako "widoczną" dla innych operatorów (patrz `list_shared_sessions`)
/// i przygotowuje pusty plik live-tail.
pub fn register_session(session_id: &str, operator: &str, label: &str) {
    let mut index = load_index();
    index.insert(
        session_id.to_string(),
        SharedSessionInfo {
            session_id: session_id.to_string(),
            operator: operator.to_string(),
            label: label.to_string(),
            started_at: chrono::Utc::now().to_rfc3339(),
        },
    );
    save_index(&index);
    if let Some(parent) = live_tail_path(session_id).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::File::create(live_tail_path(session_id));
}

/// Wołane przez `pty.rs` przy zamknięciu sesji — usuwa z rejestru i
/// sprząta plik live-tail (recordingi NIE są usuwane — to trwałe archiwum).
pub fn unregister_session(session_id: &str) {
    let mut index = load_index();
    index.remove(session_id);
    save_index(&index);
    let _ = std::fs::remove_file(live_tail_path(session_id));
}

/// Dopisuje kawałek outputu PTY do pliku live-tail danej sesji, z
/// prostą rotacją: gdy plik przekroczy `MAX_LIVE_TAIL_BYTES`, ucinamy go
/// do samego końca zamiast pozwolić rosnąć bez ograniczeń — to tylko
/// podgląd "na żywo", nie archiwum (od tego jest nagrywanie, patrz niżej).
pub fn append_live_tail(session_id: &str, chunk: &str) {
    let path = live_tail_path(session_id);
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(chunk.as_bytes());
    }
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_LIVE_TAIL_BYTES {
            if let Ok(content) = std::fs::read(&path) {
                let tail_start = content.len().saturating_sub((MAX_LIVE_TAIL_BYTES / 2) as usize);
                let _ = std::fs::write(&path, &content[tail_start..]);
            }
        }
    }
}

/// Każdy zalogowany operator widzi ROSTER (kto ma otwarty terminal) — to
/// niska wrażliwość informacji. Faktyczny PODGLĄD treści (patrz
/// `watch_session_start`) jest ograniczony do roli Lead.
#[tauri::command]
pub fn list_shared_sessions() -> Vec<SharedSessionInfo> {
    let mut sessions: Vec<SharedSessionInfo> = load_index().into_values().collect();
    sessions.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    sessions
}

// ---------------------------------------------------------------------------
// Podgląd na żywo (watch) — ten sam wzorzec pollingu co audit-tail w logs.rs
// ---------------------------------------------------------------------------

static ACTIVE_WATCH: Lazy<Mutex<Option<Arc<AtomicBool>>>> = Lazy::new(|| Mutex::new(None));

#[derive(Serialize, Clone)]
struct WatchOutputEvent {
    session_id: String,
    chunk: String,
}

fn stop_active_watch() {
    if let Some(flag) = ACTIVE_WATCH.lock().unwrap().take() {
        flag.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn watch_session_start(window: Window, session_id: String) -> Result<(), String> {
    let session = crate::auth::require_role(crate::auth::Role::Lead)?;
    stop_active_watch();

    let path = live_tail_path(&session_id);
    if !path.exists() {
        return Err("Ta sesja terminala już nie istnieje (operator ją zamknął).".to_string());
    }

    crate::audit::log_event(
        "terminal.session_watch_start",
        &session.username,
        serde_json::json!({ "session_id": session_id }),
    );

    let stop_flag = Arc::new(AtomicBool::new(false));
    *ACTIVE_WATCH.lock().unwrap() = Some(stop_flag.clone());

    let sid = session_id.clone();
    std::thread::spawn(move || {
        let mut offset: u64 = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        while !stop_flag.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let Ok(mut file) = std::fs::File::open(&path) else { break }; // sesja padła — kończymy podgląd
            let Ok(meta) = file.metadata() else { continue };
            if meta.len() < offset {
                offset = 0; // plik został zrotowany (patrz append_live_tail)
            }
            if meta.len() == offset {
                continue;
            }
            if file.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let mut buf = String::new();
            if file.read_to_string(&mut buf).is_err() {
                continue;
            }
            offset = meta.len();
            if window.emit("watch://output", WatchOutputEvent { session_id: sid.clone(), chunk: buf }).is_err() {
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn watch_session_stop() {
    stop_active_watch();
}

// ---------------------------------------------------------------------------
// Nagrywanie (asciinema v2 .cast) — opt-in przez Ustawienia
// ---------------------------------------------------------------------------

struct RecordingHandle {
    file: std::fs::File,
    started_at: std::time::Instant,
}

static RECORDINGS: Lazy<Mutex<HashMap<String, RecordingHandle>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn recording_path(session_id: &str, operator: &str) -> PathBuf {
    let safe_operator: String = operator.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
    recordings_dir().join(format!("{}-{safe_operator}-{session_id}.cast", chrono::Utc::now().format("%Y%m%dT%H%M%S")))
}

/// Wołane przez `pty.rs` przy starcie sesji, TYLKO gdy
/// `terminal_recording_enabled` jest włączone — zapisuje nagłówek
/// asciinema v2 (JSON w pierwszej linii pliku, potem strumień zdarzeń
/// `[czas_s, "o", dane]` — dokładnie format opisany na
/// https://docs.asciinema.org/manual/asciicast/v2/).
pub fn start_recording(session_id: &str, operator: &str, cols: u16, rows: u16) {
    let path = recording_path(session_id, operator);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(mut file) = std::fs::File::create(&path) else { return };
    let header = serde_json::json!({
        "version": 2,
        "width": cols,
        "height": rows,
        "timestamp": chrono::Utc::now().timestamp(),
        "env": { "TERM": "xterm-256color" },
        "title": format!("Penetration Mode — {operator}"),
    });
    if writeln!(file, "{header}").is_err() {
        return;
    }
    RECORDINGS.lock().unwrap().insert(session_id.to_string(), RecordingHandle { file, started_at: std::time::Instant::now() });
}

/// Dopisuje jedną klatkę outputu do nagrania danej sesji, jeśli
/// nagrywanie zostało dla niej uruchomione (`start_recording`) — no-op
/// (tania sprawdzana obecność w mapie) gdy nagrywanie jest wyłączone.
pub fn append_recording(session_id: &str, chunk: &str) {
    let mut guard = RECORDINGS.lock().unwrap();
    if let Some(handle) = guard.get_mut(session_id) {
        let elapsed = handle.started_at.elapsed().as_secs_f64();
        let event = serde_json::json!([elapsed, "o", chunk]);
        let _ = writeln!(handle.file, "{event}");
    }
}

pub fn stop_recording(session_id: &str) {
    RECORDINGS.lock().unwrap().remove(session_id);
}

#[derive(Serialize)]
pub struct RecordingInfo {
    pub filename: String,
    pub size_bytes: u64,
    pub modified: Option<String>,
}

/// Lista dostępnych nagrań (Lead — to archiwum sesji terminala INNYCH
/// operatorów, ta sama wrażliwość co podgląd na żywo).
#[tauri::command]
pub fn list_terminal_recordings() -> Result<Vec<RecordingInfo>, String> {
    crate::auth::require_role(crate::auth::Role::Lead)?;
    let dir = recordings_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(vec![]) };

    let mut recordings: Vec<RecordingInfo> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("cast"))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let modified = meta.modified().ok().and_then(|t| {
                let secs = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
                chrono::DateTime::from_timestamp(secs as i64, 0).map(|dt| dt.to_rfc3339())
            });
            Some(RecordingInfo { filename: e.file_name().to_string_lossy().to_string(), size_bytes: meta.len(), modified })
        })
        .collect();

    recordings.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(recordings)
}

fn safe_recording_path(filename: &str) -> Result<PathBuf, String> {
    // Odrzucamy separator ścieżek/`..` — `filename` przychodzi z frontendu
    // (wybór z listy `list_terminal_recordings`, ale nie ufamy ślepo, że
    // ktoś nie wywoła tej komendy bezpośrednio z dowolnym stringiem).
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Nieprawidłowa nazwa pliku nagrania.".to_string());
    }
    let path = recordings_dir().join(filename);
    if !path.exists() {
        return Err("Nagranie nie istnieje.".to_string());
    }
    Ok(path)
}

#[tauri::command]
pub fn read_terminal_recording(filename: String) -> Result<String, String> {
    crate::auth::require_role(crate::auth::Role::Lead)?;
    let path: PathBuf = safe_recording_path(&filename)?;
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Wystawione dla `pty.rs`, żeby wiedziało, czy w ogóle warto zaczynać
/// nagrywanie dla nowej sesji, bez importowania `settings.rs` bezpośrednio
/// tam (utrzymuje odpowiedzialność "czy nagrywać" w jednym miejscu).
pub fn recording_enabled() -> bool {
    crate::settings::get_app_settings().terminal_recording_enabled
}
