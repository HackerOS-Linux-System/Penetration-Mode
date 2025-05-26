use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::process::Command;
use tokio::time::{sleep, Duration};

#[derive(Deserialize)]
pub struct ContainerRequest {
    pub image: String,
    pub command: String,
    pub profile: String,
    pub use_gpu: bool,
    pub priority: u8,
}

pub async fn schedule_session(session_id: &str, request: &ContainerRequest, schedule: &str) {
    let scheduled_time = DateTime::parse_from_rfc3339(schedule).unwrap().with_timezone(&Utc);
    let now = Utc::now();
    let duration = (scheduled_time - now).num_milliseconds().max(0) as u64;
    sleep(Duration::from_millis(duration)).await;

    let session_dir = format!("/tmp/penmode-session-{}", session_id);
    std::fs::create_dir_all(&session_dir).unwrap();

    Command::new("podman")
        .args([
            "run",
            "--rm",
            "-it",
            "--network=host",
            "-v",
            &format!("{}:/data", session_dir),
            &request.image,
            "sh",
            "-c",
            &request.command,
        ])
        .spawn()
        .ok();
}

pub async fn run_scheduler() {
    loop {
        // Logika sprawdzania zaplanowanych sesji
        sleep(Duration::from_secs(60)).await;
    }
}
