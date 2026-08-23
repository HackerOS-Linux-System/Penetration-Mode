use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Rate limiting / lockout po nieudanych próbach logowania — dotąd PAM
/// sam w sobie nie ograniczał niczego od strony appki: ktoś z dostępem do
/// ekranu logowania mógł próbować haseł bez żadnego ograniczenia poza
/// tym, co (jeśli cokolwiek) egzekwuje sam PAM na danym hoście.
///
/// Persystowane do pliku (nie tylko w pamięci procesu) świadomie — samo
/// zrestartowanie appki nie powinno trywialnie zerować blokady, inaczej
/// mechanizm byłby ozdobą, nie realnym ograniczeniem.
///
/// `SystemTime`/unix millis (nie `Instant` jak w idle timeoucie) tutaj
/// celowo: ten stan musi przetrwać restart procesu, więc potrzebuje
/// znacznika czasu porównywalnego między uruchomieniami, nie tylko
/// wewnątrz jednego.
#[derive(Serialize, Deserialize, Default, Clone)]
struct AttemptLog(HashMap<String, Vec<i64>>);

fn attempts_path() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("penetration-mode").join("login_attempts.json")
}

fn load() -> AttemptLog {
    std::fs::read_to_string(attempts_path()).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

fn save(log: &AttemptLog) {
    let path = attempts_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(log) {
        let _ = std::fs::write(&path, bytes);
    }
}

static ATTEMPTS: Lazy<Mutex<AttemptLog>> = Lazy::new(|| Mutex::new(load()));

fn now_millis() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Zwraca `Err` z czytelnym komunikatem (ile minut do odblokowania), jeśli
/// `username` przekroczył `max_login_attempts` nieudanych prób w oknie
/// `lockout_minutes` (oba z Ustawień). `max_login_attempts == 0` wyłącza
/// rate limiting całkowicie (świadoma decyzja operatora/Leada).
pub fn check_lockout(username: &str) -> Result<(), String> {
    let settings = crate::settings::get_app_settings();
    if settings.max_login_attempts == 0 {
        return Ok(());
    }

    let window_ms = i64::from(settings.lockout_minutes) * 60_000;
    let now = now_millis();

    let mut log = ATTEMPTS.lock().unwrap();
    let recent: Vec<i64> = log.0.get(username).map(|v| v.iter().copied().filter(|&t| now - t < window_ms).collect()).unwrap_or_default();

    if recent.len() as u32 >= settings.max_login_attempts {
        let oldest_in_window = *recent.iter().min().unwrap_or(&now);
        let unlocks_in_ms = window_ms - (now - oldest_in_window);
        let unlocks_in_min = (unlocks_in_ms.max(0) / 60_000) + 1;
        // Sprzątamy przy okazji (nie tylko filtrujemy do odczytu) — inaczej
        // plik rósłby w nieskończoność przy powtarzających się próbach.
        log.0.insert(username.to_string(), recent);
        return Err(format!(
            "Konto '{username}' zablokowane po {} nieudanych próbach. Spróbuj ponownie za ~{unlocks_in_min} min.",
            settings.max_login_attempts
        ));
    }

    log.0.insert(username.to_string(), recent);
    Ok(())
}

/// Wołane po nieudanej próbie logowania (zły PIN/hasło, nie błąd
/// infrastruktury PAM) — dopisuje znacznik czasu do historii tego
/// użytkownika i loguje `auth.login_failed` do audytu.
pub fn record_failed_attempt(username: &str) {
    let mut log = ATTEMPTS.lock().unwrap();
    log.0.entry(username.to_string()).or_default().push(now_millis());
    save(&log);
}

/// Wołane po udanym logowaniu — czyści historię nieudanych prób, żeby
/// legalny operator, który się w końcu zalogował poprawnie, nie zostawał
/// "na krawędzi" blokady przy następnej pomyłce we `wpisywaniu hasła.
pub fn clear_attempts(username: &str) {
    let mut log = ATTEMPTS.lock().unwrap();
    if log.0.remove(username).is_some() {
        save(&log);
    }
}
