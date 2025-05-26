use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::process::Command;
use uuid::Uuid;

mod podman;
mod session;
mod crypto;

#[derive(Serialize, Deserialize)]
struct ContainerRequest {
    image: String,
    command: String,
    profile: String,
    use_gpu: bool,
}

#[derive(Serialize)]
struct ContainerResponse {
    session_id: String,
    status: String,
    output: String,
    error: Option<String>,
}

async fn start_container(data: web::Json<ContainerRequest>) -> impl Responder {
    let session_id = Uuid::new_v4().to_string();
    let session_dir = format!("/tmp/penmode-session-{}", session_id);
    std::fs::create_dir_all(&session_dir).unwrap();

    let mut cmd = Command::new("podman");
    cmd.args(["run", "--rm", "-it", "--network=host", "-v", &format!("{}:/data", session_dir)]);

    if data.use_gpu {
        cmd.arg("--device=/dev/nvidia0"); // Przykład dla GPU NVIDIA
    }

    cmd.args([&data.image, "sh", "-c", &data.command]);

    let output = cmd.output();
    let conn = Connection::open_in_memory().unwrap();
    session::init_db(&conn);
    session::save_session(&conn, &session_id, &data.profile, &data.command);

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let encrypted_output = crypto::encrypt_output(&stdout);
            podman::cleanup_tmp_session(&session_id);
            HttpResponse::Ok().json(ContainerResponse {
                session_id,
                status: "success".to_string(),
                output: encrypted_output,
                error: if stderr.is_empty() { None } else { Some(stderr) },
            })
        }
        Err(e) => {
            podman::cleanup_tmp_session(&session_id);
            HttpResponse::InternalServerError().json(ContainerResponse {
                session_id,
                status: "error".to_string(),
                output: "".to_string(),
                error: Some(e.to_string()),
            })
        }
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .route("/api/container/start", web::post().to(start_container))
    })
    .bind("127.0.0.1:8080")?
    .run()
    .await
}
