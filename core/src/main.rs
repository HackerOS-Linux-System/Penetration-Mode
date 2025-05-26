use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::process::Command;
use uuid::Uuid;

mod podman;
mod session;
mod crypto;
mod resources;
mod scheduler;

#[derive(Serialize, Deserialize)]
struct ContainerRequest {
    image: String,
    command: String,
    profile: String,
    use_gpu: bool,
    priority: u8,
    schedule: Option<String>, // ISO 8601, np. "2025-05-26T15:30:00Z"
}

#[derive(Serialize)]
struct ContainerResponse {
    session_id: String,
    status: String,
    output: String,
    error: Option<String>,
    resources: resources::ResourceUsage,
}

async fn start_container(data: web::Json<ContainerRequest>) -> impl Responder {
    let session_id = Uuid::new_v4().to_string();
    let session_dir = format!("/tmp/penmode-session-{}", session_id);
    std::fs::create_dir_all(&session_dir).unwrap();

    if let Some(schedule) = &data.schedule {
        scheduler::schedule_session(&session_id, &data, schedule);
        return HttpResponse::Ok().json(ContainerResponse {
            session_id,
            status: "scheduled".to_string(),
            output: "".to_string(),
            error: None,
            resources: resources::get_usage(),
        });
    }

    let mut cmd = Command::new("podman");
    cmd.args([
        "run",
        "--rm",
        "-it",
        "--network=host",
        "-v",
        &format!("{}:/data", session_dir),
        "--cpus",
        &format!("{}", data.priority as f32 / 10.0),
        "--memory",
        "512m",
    ]);

    if data.use_gpu {
        cmd.arg("--device=/dev/nvidia0");
    }

    cmd.args([&data.image, "sh", "-c", &data.command]);

    let output = cmd.output();
    let conn = Connection::open_in_memory().unwrap();
    session::init_db(&conn);
    session::save_session(&conn, &session_id, &data.profile, &data.command, data.priority);

    let resources = resources::get_usage();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let encrypted_output = crypto::encrypt_output(&stdout, &session_id);
            podman::cleanup_tmp_session(&session_id);
            HttpResponse::Ok().json(ContainerResponse {
                session_id,
                status: "success".to_string(),
                output: encrypted_output,
                error: if stderr.is_empty() { None } else { Some(stderr) },
                resources,
            })
        }
        Err(e) => {
            podman::cleanup_tmp_session(&session_id);
            HttpResponse::InternalServerError().json(ContainerResponse {
                session_id,
                status: "error".to_string(),
                output: "".to_string(),
                error: Some(e.to_string()),
                resources,
            })
        }
    }
}

async fn pause_session(session_id: web::Path<String>) -> impl Responder {
    let output = Command::new("podman")
        .args(["pause", &session_id])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    HttpResponse::Ok().json(serde_json::json!({ "status": "paused", "output": output }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tokio::spawn(scheduler::run_scheduler());
    HttpServer::new(|| {
        App::new()
            .route("/api/container/start", web::post().to(start_container))
            .route("/api/session/pause/{session_id}", web::get().to(pause_session))
    })
    .bind("127.0.0.1:8080")?
    .run()
    .await
}
