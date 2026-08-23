mod audit;
mod auth;
mod blackarch;
mod lockout;
mod logs;
mod presence;
mod pty;
mod remote_audit;
mod session_share;
mod settings;
mod snippets;
mod terminal_state;
mod threat_feed;

use serde::Serialize;

#[derive(Serialize)]
struct HostStatus {
    hostname: String,
    os: String,
    arch: String,
}

/// Placeholder command — dziś zwraca statyczne dane, docelowo ma czytać
/// realny stan hosta/kontenera (patrz sekcja "co wymaga rozbudowy").
/// Kontrakt wejścia/wyjścia tej komendy powinien trafić do `ipc/`,
/// jak tylko ustalimy tam wspólny schemat frontend<->backend.
#[tauri::command]
fn get_host_status() -> HostStatus {
    HostStatus {
        hostname: "container_blackarch_alpha_01".into(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_host_status,
            // Auth / sesja operatora (stand-in pod SSO/LDAP — patrz auth.rs)
            auth::login,
            auth::logout,
            auth::current_session,
            auth::no_login_active,
            auth::session_heartbeat,
            // Audit log (+ weryfikacja integralności łańcucha HMAC — Runda 8;
            // notatki przypięte do wpisów — Runda 10)
            audit::read_audit_log,
            audit::verify_audit_log,
            audit::add_audit_note,
            // Eksport/replikacja audit logu na zewnątrz (syslog/webhook — Runda 10)
            remote_audit::get_remote_audit_config,
            remote_audit::set_remote_audit_config,
            // BlackArch Store (podman + pacman)
            blackarch::check_podman,
            blackarch::container_status,
            blackarch::ensure_container,
            blackarch::list_categories,
            blackarch::installed_packages,
            blackarch::search_packages,
            blackarch::packages_in_category,
            blackarch::install_package,
            blackarch::remove_package,
            blackarch::get_allowlist,
            blackarch::set_allowlist,
            // Terminal — prawdziwy PTY w kontenerze Store, wiele sesji (taby)
            pty::pty_start,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_stop,
            pty::pty_stop_all,
            // Trwały stan tabów terminala (scrollback) między restartami appki
            terminal_state::save_terminal_tabs,
            terminal_state::load_terminal_tabs,
            // Współdzielenie sesji terminala (podgląd przez Lead) i nagrywanie
            // asciinema — Runda 10
            session_share::list_shared_sessions,
            session_share::watch_session_start,
            session_share::watch_session_stop,
            session_share::list_terminal_recordings,
            session_share::read_terminal_recording,
            // Snippety/makra poleceń terminala — Runda 10
            snippets::get_snippets,
            snippets::set_snippets,
            // Kto jest teraz aktywny (widok Team) — Runda 10
            presence::list_active_operators,
            // Druga konsola — live tail logów (kontener / audit / system)
            logs::logs_tail_start,
            logs::logs_tail_stop,
            // Ustawienia aplikacji (terminal, logi, wygląd, motyw, idle timeout)
            settings::get_app_settings,
            settings::set_app_settings,
            // Źródła danych (sieć + threat feed)
            threat_feed::get_network_stats,
            threat_feed::get_threat_feed,
            threat_feed::get_threat_feed_config,
            threat_feed::set_threat_feed_config,
            threat_feed::get_threat_feed_status,
        ])
        .setup(|_app| {
            // Odświeżanie threat feedu w tle (Runda 10) — niezależne od tego,
            // czy/kiedy frontend akurat odpytuje `get_threat_feed()`. Patrz
            // komentarz przy `threat_feed::spawn_background_refresh`.
            threat_feed::spawn_background_refresh();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
