pub fn cleanup_tmp_session(session_id: &str) {
    let session_dir = format!("/tmp/penmode-session-{}", session_id);
    std::fs::remove_dir_all(&session_dir).ok();
}

pub fn limit_resources(session_id: &str, cpu: f32, memory: u64) {
    std::process::Command::new("podman")
        .args([
            "update",
            "--cpus",
            &cpu.to_string(),
            "--memory",
            &format!("{}m", memory),
            session_id,
        ])
        .output()
        .ok();
}
