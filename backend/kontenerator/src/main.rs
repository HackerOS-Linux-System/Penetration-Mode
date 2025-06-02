use anyhow::{Context, Result};
use log::{error, info};
use std::process::Command;

fn start_container() -> Result<()> {
    info!("Starting Kali Linux container with enhanced security...");
    
    // Create tmpfs volume
    Command::new("docker")
        .args(&["volume", "create", "penetration_mode_tmpfs"])
        .output()
        .context("Failed to create tmpfs volume")?;

    // Start container with strict security options
    let output = Command::new("docker")
        .args(&[
            "run",
            "-d",
            "--rm",
            "--name",
            "penetration_mode",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt",
            "no-new-privileges",
            "--network",
            "none", // Enhanced network isolation
            "--memory",
            "512m", // Memory limit
            "--cpus",
            "1", // CPU limit
            "-v",
            "penetration_mode_tmpfs:/tmp:ro",
            "kalilinux/kali-rolling",
            "sleep",
            "infinity",
        ])
        .output()
        .context("Failed to start container")?;

    if !output.status.success() {
        error!("Container start failed: {:?}", output.stderr);
        return Err(anyhow::anyhow!("Container start failed"));
    }
    info!("Container started successfully");
    Ok(())
}

fn stop_container() -> Result<()> {
    info!("Stopping container...");
    let output = Command::new("docker")
        .args(&["kill", "penetration_mode"])
        .output()
        .context("Failed to stop container")?;

    if !output.status.success() {
        error!("Container stop failed: {:?}", output.stderr);
        return Err(anyhow::anyhow!("Container stop failed"));
    }
    info!("Container stopped successfully");
    Ok(())
}

fn main() -> Result<()> {
    env_logger::init();
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        error!("Invalid usage: {} [start|stop]", args[0]);
        return Err(anyhow::anyhow!("Usage: {} [start|stop]", args[0]));
    }

    match args[1].as_str() {
        "start" => start_container(),
        "stop" => stop_container(),
        _ => {
            error!("Invalid command: {}", args[1]);
            Err(anyhow::anyhow!("Invalid command: {}", args[1]))
        }
    }
}
