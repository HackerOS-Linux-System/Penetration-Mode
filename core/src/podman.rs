use std::fs;
use std::process::Command;

pub fn cleanup_tmp_session(session_id: &str) {
    let session_dir = format!("/tmp/penmode-session-{}", session_id);
    std::fs::remove_dir_all(&session_dir).unwrap_or(());
}

#[allow(dead_code)]
pub fn limit_resources(session_id: &str, cpu: f32, memory: u64) {
    let mut cmd = Command::new("podman");
    cmd.args([
        "update",
        &format!("--cpus={}", cpu),
        &format!("--memory={}m", memory),
        session_id,
    ]);
    cmd.spawn().ok();
}
