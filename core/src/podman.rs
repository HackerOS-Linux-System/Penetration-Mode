// Tu można dodać bardziej zaawansowane funkcje zarządzania Podmanem, np. tworzenie sesji, czyszczenie /tmp itp.
pub fn cleanup_tmp_session(session_id: &str) {
    // Przykład: usuwanie tymczasowego katalogu /tmp/penmode-session-XYZ
    std::fs::remove_dir_all(format!("/tmp/penmode-session-{}", session_id)).ok();
}
