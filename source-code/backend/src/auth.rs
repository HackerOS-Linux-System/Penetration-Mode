use crate::lockout;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Może instalować/usuwać pakiety, uruchamiać terminal, skanować.
    Operator,
    /// Jak Operator + zarządzanie allowlistą pakietów, resetowanie kontenera.
    Lead,
    /// Tylko podgląd: dashboard, analytics, audit log. Bez akcji zmieniających stan.
    Auditor,
}

impl Role {
    pub fn can_mutate(self) -> bool {
        matches!(self, Role::Operator | Role::Lead)
    }
    pub fn can_manage_allowlist(self) -> bool {
        matches!(self, Role::Lead)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub token: String,
    pub username: String,
    pub role: Role,
}

static CURRENT_SESSION: Lazy<Mutex<Option<Session>>> = Lazy::new(|| Mutex::new(None));

/// Znacznik czasu ostatniej aktywności operatora — patrz [`touch_activity`]/
/// [`session_heartbeat`]. `Instant` (nie `SystemTime`) celowo: liczy nam się
/// tylko upływ czasu wewnątrz jednego uruchomienia procesu, nie zegar
/// ścienny (którego przesunięcie — np. NTP, zmiana strefy — nie powinno
/// móc ani przedwcześnie wylogować operatora, ani sztucznie przedłużyć
/// sesję).
static LAST_ACTIVITY: Lazy<Mutex<Option<Instant>>> = Lazy::new(|| Mutex::new(None));

fn touch_activity() {
    *LAST_ACTIVITY.lock().unwrap() = Some(Instant::now());
}

/// Wywoływane przez frontend na realną aktywność operatora (ruch myszy,
/// klawiatura — throttlowane po stronie frontendu, patrz `lib/idle.ts`),
/// żeby licznik bezczynności z Ustawień (`idle_timeout_minutes`) się
/// zerował. Samo odpytywanie `current_session()` (np. przez frontendowy
/// interwał sprawdzający czy sesja wciąż żyje) NIE liczy się jako
/// aktywność — inaczej idle timeout nigdy by się nie uruchomił, skoro to
/// odpytywanie samo w sobie trwa cały czas w tle.
#[tauri::command]
pub fn session_heartbeat() {
    touch_activity();
    crate::presence::touch(CURRENT_SESSION.lock().unwrap().as_ref());
}

/// Ścieżka pliku-znacznika, którego obecność wyłącza ekran logowania
/// (patrz [`no_login_marker_present`]). Trzymana per-user w `~/.config`,
/// żeby ustawienie tego trybu wymagało już posiadania dostępu do konta,
/// dla którego ma działać — to świadomy tryb zaufany dla właściciela
/// maszyny/kontenera (np. lokalny dev/lab), a nie obejście dla kogoś bez
/// dostępu do tego konta.
fn no_login_marker_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".config/hackeros/Penetration-Mode/.no-login"))
}

/// `true` gdy plik-znacznik istnieje. Celowo sprawdzane na nowo przy
/// każdym wywołaniu (a nie raz, przy starcie) — usunięcie pliku w trakcie
/// działania appki natychmiast przywraca normalny wymóg logowania dla
/// kolejnych sesji/wywołań `current_session`.
fn no_login_marker_present() -> bool {
    no_login_marker_path().is_some_and(|p| p.is_file())
}

/// Nazwa systemowego użytkownika uruchamiającego proces — używana jako
/// `username` sesji auto-zalogowanej w trybie `.no-login`, żeby audit log
/// dalej wskazywał na realne konto, a nie na jakąś fikcyjną nazwę.
fn current_os_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

/// Tworzy (jeśli jeszcze nie istnieje) sesję auto-zalogowaną trybu
/// `.no-login`: bez PAM, z rolą `Lead` (najwyższa — brak jakichkolwiek
/// ograniczeń UI/uprawnień). Zdarzenie zawsze trafia do audit logu, żeby
/// ten tryb pozostał widoczny/śledzalny nawet gdy nikt nie wpisał hasła.
fn ensure_no_login_session() -> Session {
    let mut guard = CURRENT_SESSION.lock().unwrap();
    if let Some(session) = guard.as_ref() {
        return session.clone();
    }
    let session = Session {
        token: Uuid::new_v4().to_string(),
        username: current_os_username(),
        role: Role::Lead,
    };
    *guard = Some(session.clone());
    drop(guard);
    crate::audit::log_event(
        "auth.no_login_bypass",
        &session.username,
        serde_json::json!({
            "role": session.role,
            "marker": no_login_marker_path().map(|p| p.display().to_string()),
        }),
    );
    session
}

fn pam_service() -> String {
    std::env::var("CYBERSEC_MODE_PAM_SERVICE").unwrap_or_else(|_| "login".to_string())
}

/// Weryfikuje login/hasło przez PAM. To jest jedyne miejsce, które trzeba
/// by podmienić, gdyby host kiedyś NIE miał PAM (np. odizolowany kontener
/// bez systemowej bazy użytkowników) — kontrakt (`Result<(), String>`)
/// zostaje ten sam.
fn authenticate(username: &str, password: &str) -> Result<(), String> {
    let service = pam_service();

    let mut authenticator = pam::Authenticator::with_password(&service).map_err(|e| {
        format!("nie udało się zainicjalizować PAM (usługa '{service}'): {e}. Sprawdź, czy /etc/pam.d/{service} istnieje na tym hoście, albo ustaw CYBERSEC_MODE_PAM_SERVICE na inną usługę.")
    })?;

    authenticator.get_handler().set_credentials(username, password);

    authenticator
        .authenticate()
        .map_err(|_| "Nieprawidłowy login lub hasło.".to_string())?;

    // Celowo NIE wołamy `authenticator.open_session()` — appce chodzi
    // wyłącznie o weryfikację tożsamości, nie o zakładanie pełnej sesji
    // loginowej (limity zasobów, zmienne środowiskowe sesji itd.).

    Ok(())
}

/// Wylicza rolę na podstawie przynależności do grup uniksowych. Brak
/// dopasowania → `Role::Auditor` (bezpieczny domyślny wybór: podgląd bez
/// możliwości psucia czegokolwiek), nie odmowa logowania.
fn resolve_role(username: &str) -> Role {
    let lead_group = std::env::var("CYBERSEC_MODE_LEAD_GROUP").unwrap_or_else(|_| "redteam-lead".to_string());
    let operator_group =
        std::env::var("CYBERSEC_MODE_OPERATOR_GROUP").unwrap_or_else(|_| "redteam-operator".to_string());

    let groups_output = Command::new("id").args(["-nG", username]).output();

    let groups: Vec<String> = match groups_output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).split_whitespace().map(|s| s.to_string()).collect()
        }
        _ => vec![],
    };

    if groups.iter().any(|g| g == &lead_group) {
        Role::Lead
    } else if groups.iter().any(|g| g == &operator_group) {
        Role::Operator
    } else {
        Role::Auditor
    }
}

#[tauri::command]
pub fn login(username: String, password: String) -> Result<Session, String> {
    // Tryb `.no-login`: pomijamy PAM całkowicie — nie tylko dlatego, że to
    // zbędne, ale żeby ten tryb nie mógł nigdy zablokować się na złym
    // haśle wpisanym w formularzu, gdyby ekran logowania z jakiegoś
    // powodu jednak się pokazał (patrz `current_session`, które normalnie
    // sprawia, że frontend w ogóle go nie renderuje w tym trybie).
    if no_login_marker_present() {
        return Ok(ensure_no_login_session());
    }
    if let Err(e) = lockout::check_lockout(&username) {
        crate::audit::log_event("auth.login_blocked", &username, serde_json::json!({ "reason": &e }));
        return Err(e);
    }
    if let Err(e) = authenticate(&username, &password) {
        lockout::record_failed_attempt(&username);
        crate::audit::log_event("auth.login_failed", &username, serde_json::json!({}));
        return Err(e);
    }
    lockout::clear_attempts(&username);
    let role = resolve_role(&username);
    let session = Session { token: Uuid::new_v4().to_string(), username, role };
    *CURRENT_SESSION.lock().unwrap() = Some(session.clone());
    touch_activity();
    crate::presence::touch(Some(&session));
    crate::audit::log_event("auth.login", &session.username, serde_json::json!({ "role": session.role }));
    Ok(session)
}

#[tauri::command]
pub fn logout() {
    // W trybie `.no-login` "wylogowanie" jest natychmiast odtwarzane przy
    // następnym `current_session` (dopóki plik-znacznik istnieje) — to
    // celowe: przycisk "wyloguj" w UI nie ma w tym trybie sensownego
    // efektu końcowego (nie ma do czego wrócić), więc niech po prostu nic
    // trwale nie psuje zamiast wyglądać na zepsuty.
    if let Some(session) = CURRENT_SESSION.lock().unwrap().take() {
        crate::audit::log_event("auth.logout", &session.username, serde_json::json!({}));
    }
    crate::presence::touch(None);
    *LAST_ACTIVITY.lock().unwrap() = None;
}

/// Sprawdza i (jeśli trzeba) egzekwuje idle timeout z Ustawień
/// (`idle_timeout_minutes`, 0 = wyłączone). Wołane z [`current_session`]
/// zamiast osobnego tickera po stronie backendu — prostsze niż wątek z
/// interwałem, i wystarczające, bo frontend i tak odpytuje
/// `current_session()` cyklicznie (patrz `lib/idle.ts`), więc wygaśnięcie
/// zostanie wykryte najdalej przy następnym odpytaniu.
fn enforce_idle_timeout() {
    let timeout_minutes = crate::settings::get_app_settings().idle_timeout_minutes;
    if timeout_minutes == 0 {
        return;
    }

    let mut activity_guard = LAST_ACTIVITY.lock().unwrap();
    let Some(last_activity) = *activity_guard else { return };
    let timeout = std::time::Duration::from_secs(u64::from(timeout_minutes) * 60);
    if last_activity.elapsed() < timeout {
        return;
    }

    let mut session_guard = CURRENT_SESSION.lock().unwrap();
    if let Some(session) = session_guard.take() {
        drop(session_guard);
        crate::presence::touch(None);
        crate::audit::log_event(
            "auth.session_timeout",
            &session.username,
            serde_json::json!({ "idle_timeout_minutes": timeout_minutes }),
        );
    }
    *activity_guard = None;
}

#[tauri::command]
pub fn current_session() -> Option<Session> {
    if no_login_marker_present() {
        return Some(ensure_no_login_session());
    }
    enforce_idle_timeout();
    CURRENT_SESSION.lock().unwrap().clone()
}

/// Czy tryb `.no-login` jest aktywny — dla frontendu, żeby mógł np.
/// pokazać stały banner ostrzegawczy zamiast cicho pomijać ekran logowania
/// bez żadnego sygnału dla operatora, że sesja nie jest w tym trybie
/// autoryzowana hasłem.
#[tauri::command]
pub fn no_login_active() -> bool {
    no_login_marker_present()
}

/// Pomocnicze do innych modułów: kto jest aktualnie zalogowany (do audit logu),
/// z fallbackiem na "unknown" gdyby ktoś wywołał komendę bez zalogowania
/// (nie powinno się zdarzyć, bo frontend blokuje UI przed loginem — ale
/// backend nie ufa frontendowi ślepo).
pub fn current_username() -> String {
    CURRENT_SESSION
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.username.clone())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn require_role(min: Role) -> Result<Session, String> {
    let session = CURRENT_SESSION
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Brak aktywnej sesji — zaloguj się.".to_string())?;

    let ok = match min {
        Role::Auditor => true, // każdy zalogowany
        Role::Operator => session.role.can_mutate(),
        Role::Lead => session.role.can_manage_allowlist(),
    };

    if ok {
        Ok(session)
    } else {
        Err(format!("Rola '{:?}' nie ma uprawnień do tej akcji.", session.role))
    }
}
