use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Preferencje UI/aplikacji, oddzielone celowo od `ThreatFeedConfig`
/// (threat_feed.rs) i `Allowlist` (blackarch.rs) — tamte dwa mają własne
/// reguły uprawnień (np. tylko `Lead` może zmieniać allowlistę), podczas
/// gdy to tu jest zwykłe "jak appka ma wyglądać/zachowywać się dla mnie",
/// więc może to zmienić każda zalogowana rola bez ograniczeń.
///
/// `#[serde(default)]` na strukturze (nie tylko per-pole) — dzięki temu
/// dopisanie nowego pola tutaj (jak w Rundzie 8: `theme`,
/// `idle_timeout_minutes`, `onboarding_completed`,
/// `terminal_restore_scrollback`) nigdy nie wywali deserializacji
/// starego `settings.json` zapisanego przed tą zmianą — brakujące pole
/// dostaje wartość z `Default::default()` zamiast błędu parsowania.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    /// Rozmiar czcionki terminala (px). Domyślnie 12.
    pub terminal_font_size: u16,
    /// Ile linii scrollbacku trzyma terminal w pamięci przed przycięciem.
    pub terminal_scrollback: u32,
    /// Domyślne źródło drugiej konsoli przy starcie: "container" | "audit" | "system".
    pub logs_default_source: String,
    /// Czy druga konsola (logi) ma się od razu uruchamiać po zalogowaniu.
    pub logs_autostart: bool,
    /// Kolor akcentu UI w formacie hex (np. "#ff3333" - domyślny czerwony red-team).
    pub accent_color: String,
    /// Motyw UI: "dark" | "light" — niezależny od koloru akcentu (patrz
    /// lib/theme.ts we frontendzie). Domyślnie "dark", zgodnie z
    /// dotychczasowym jedynym motywem appki.
    pub theme: String,
    /// Dźwięk przy zdarzeniach (np. nowy wpis audytu wysokiego ryzyka).
    pub sound_enabled: bool,
    /// Czy banner ostrzegawczy `.no-login` ma dodatkowo migać (część
    /// operatorów uznaje stały banner za wystarczający i wyłącza miganie).
    pub no_login_banner_blink: bool,
    /// Auto-wylogowanie po tylu minutach bezczynności; 0 = wyłączone.
    /// Egzekwowane w `auth::current_session` (patrz jego komentarz) —
    /// ignorowane w trybie `.no-login`, który jest z założenia zaufaną
    /// sesją lokalną bez logowania hasłem.
    pub idle_timeout_minutes: u32,
    /// `false` do czasu ukończenia (lub jawnego pominięcia) wprowadzenia
    /// dla nowego operatora — patrz `components/Onboarding.tsx`.
    pub onboarding_completed: bool,
    /// Czy zawartość terminala (scrollback) ma być zapisywana i
    /// przywracana między restartami appki — patrz `terminal_state.rs`.
    pub terminal_restore_scrollback: bool,
    /// Ile nieudanych prób logowania w oknie `lockout_minutes` blokuje
    /// konto — patrz `auth.rs::check_lockout`. 0 = rate limiting wyłączony
    /// (niezalecane, ale operator może to świadomie wyłączyć).
    pub max_login_attempts: u32,
    /// Długość blokady po przekroczeniu `max_login_attempts`, w minutach.
    pub lockout_minutes: u32,
    /// Czy nagrywać sesje terminala w formacie asciinema (.cast) —
    /// domyślnie wyłączone: nagrywanie każdej sesji to realna decyzja
    /// prywatności/zgody operatora, nie coś co appka powinna robić po
    /// cichu domyślnie. Patrz `session_share.rs`.
    pub terminal_recording_enabled: bool,
    /// Czy blokować instalację pakietów, których `pacman -Qi` nie
    /// potwierdza jako `Validated By: Signature` — patrz
    /// `blackarch.rs::install_package`. Domyślnie `false` (tylko
    /// ostrzeżenie w audycie), żeby nietypowa konfiguracja repo w
    /// kontenerze nie zablokowała Arsenal całkowicie bez świadomej zgody
    /// operatora.
    pub block_unsigned_packages: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            terminal_font_size: 12,
            terminal_scrollback: 5000,
            logs_default_source: "audit".to_string(),
            logs_autostart: true,
            accent_color: "#ff3333".to_string(),
            theme: "dark".to_string(),
            sound_enabled: false,
            no_login_banner_blink: false,
            idle_timeout_minutes: 0,
            onboarding_completed: false,
            terminal_restore_scrollback: true,
            max_login_attempts: 5,
            lockout_minutes: 15,
            terminal_recording_enabled: false,
            block_unsigned_packages: false,
        }
    }
}

fn settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("penetration-mode")
        .join("settings.json")
}

#[tauri::command]
pub fn get_app_settings() -> AppSettings {
    let path = settings_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_app_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    let operator = crate::auth::current_username();
    crate::audit::log_event("settings.update", &operator, serde_json::to_value(&settings).unwrap_or_default());
    Ok(())
}
