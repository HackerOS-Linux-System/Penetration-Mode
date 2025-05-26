use std::fs;
use std::process::Command;

pub fn cleanup_tmp_session(session_id: &str) {
    let session_dir = format!("/tmp/penmode-session-{}", session_id);
    let _ = fs::remove_dir_all(&session_dir); // Ignoruje błędy, jeśli katalog nie istnieje
}

pub fn limit_resources(session_id: &str, cpu: f32, memory: u64) {
    let _ = Command::new("podman")
        .args([
            "update",
            "--cpus",
            &cpu.to_string(),
            "--memory",
            &format!("{}m", memory),
            session_id,
        ])
        .output(); // Ignoruje błędy, jeśli komenda nie powiedzie się
}
