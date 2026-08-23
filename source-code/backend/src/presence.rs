use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Rejestr "kto jest teraz aktywny" — zasila widok Team (nowa pozycja w
/// lewym pasku). Ta appka jest z natury jednoosobowa NA PROCES (jedna
/// sesja PAM na uruchomienie), więc "wielu operatorów" oznacza tutaj
/// wiele **równoległych procesów** appki, niekoniecznie na jednym koncie
/// systemowym.
///
/// **Uczciwie o granicy tego mechanizmu:** `dirs::config_dir()` (jak
/// reszta plików konfiguracyjnych appki) jest per-konto-systemowe na
/// Linuksie (`~/.config`), więc domyślnie ten plik widzą tylko procesy
/// appki uruchomione NA TYM SAMYM koncie systemowym (np. kilka
/// terminali/zakładek tej samej osoby, albo `.no-login` + normalna sesja
/// naraz). Żeby zobaczyć się nawzajem MIĘDZY różnymi kontami systemowymi
/// na współdzielonej maszynie (prawdziwy scenariusz "Lead i Operator na
/// tym samym labie"), katalog musi wskazywać na lokalizację współdzieloną
/// między kontami z odpowiednimi uprawnieniami grupy — stąd zmienna
/// środowiskowa `PENETRATION_MODE_SHARED_DIR` niżej: operacje/wdrożenie
/// mogą ją ustawić na coś w rodzaju `/var/lib/penetration-mode` (z
/// katalogiem należącym do wspólnej grupy `redteam-lead`/`redteam-operator`
/// i uprawnieniami `g+rw`), a appka bez dodatkowej konfiguracji i tak
/// działa poprawnie w obrębie jednego konta.
pub fn shared_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("PENETRATION_MODE_SHARED_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("penetration-mode")
}

fn presence_path() -> PathBuf {
    shared_dir().join("presence.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresenceEntry {
    pub instance_id: String,
    pub username: String,
    pub role: crate::auth::Role,
    pub started_at: String,
    pub last_heartbeat_ms: i64,
}

/// Losowy identyfikator TEGO uruchomienia appki (nie sesji operatora) —
/// żeby dwie zakładki/procesy tej samej osoby liczyły się jako dwie
/// osobne pozycje na liście (każda ze swoimi tabami terminala), zamiast
/// nadpisywać się nawzajem pod tym samym kluczem.
static INSTANCE_ID: Lazy<String> = Lazy::new(|| uuid::Uuid::new_v4().to_string());

/// Wpisy bez heartbeatu od tylu ms uznajemy za martwe (proces padł/został
/// zabity bez czystego wylogowania) i usuwamy przy najbliższej okazji —
/// dwukrotność interwału heartbeatu z frontendu, z zapasem.
const STALE_AFTER_MS: i64 = 90_000;

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn load() -> HashMap<String, PresenceEntry> {
    std::fs::read_to_string(presence_path()).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

fn save(map: &HashMap<String, PresenceEntry>) {
    let path = presence_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(map) {
        let _ = std::fs::write(&path, bytes);
    }
}

/// Wołane z `auth::login`/`session_heartbeat` — zapisuje/odświeża wpis dla
/// TEGO procesu. Brak sesji (nikt zalogowany w tym procesie) → usuwa
/// własny wpis zamiast go zostawiać z nieaktualnymi danymi.
pub fn touch(session: Option<&crate::auth::Session>) {
    let mut map = load();

    match session {
        Some(s) => {
            let entry = map.entry(INSTANCE_ID.clone()).or_insert_with(|| PresenceEntry {
                instance_id: INSTANCE_ID.clone(),
                username: s.username.clone(),
                role: s.role,
                started_at: chrono::Utc::now().to_rfc3339(),
                last_heartbeat_ms: now_ms(),
            });
            entry.username = s.username.clone();
            entry.role = s.role;
            entry.last_heartbeat_ms = now_ms();
        }
        None => {
            map.remove(&*INSTANCE_ID);
        }
    }

    let now = now_ms();
    map.retain(|_, e| now - e.last_heartbeat_ms < STALE_AFTER_MS);
    save(&map);
}

/// Lista aktywnych operatorów (świeży heartbeat) — widoczna dla każdego
/// zalogowanego, nie tylko Lead (widzieć KTO jest aktywny to niska
/// wrażliwość; DOSTĘP do czyjejś sesji terminala — patrz
/// `session_share.rs` — to już osobne, ograniczone do Lead uprawnienie).
#[tauri::command]
pub fn list_active_operators() -> Vec<PresenceEntry> {
    let now = now_ms();
    let mut entries: Vec<PresenceEntry> = load().into_values().filter(|e| now - e.last_heartbeat_ms < STALE_AFTER_MS).collect();
    entries.sort_by(|a, b| a.username.cmp(&b.username));
    entries
}

pub fn current_instance_id() -> &'static str {
    &INSTANCE_ID
}
