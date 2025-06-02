use anyhow::{Context, Result};
use log::{error, info};
use std::process::Command;
use std::thread;
use std::time::Duration;

fn check_container() -> Result<bool> {
    let output = Command::new("docker")
        .args(&["ps", "-q", "-f", "name=penetration_mode"])
        .output()
        .context("Failed to check container status")?;
    Ok(!output.stdout.is_empty())
}

fn check_gui() -> Result<bool> {
    let output = Command::new("pgrep")
        .args(&["-f", "python3.*main.py"])
        .output()
        .context("Failed to check GUI process")?;
    Ok(!output.stdout.is_empty())
}

fn main() -> Result<()> {
    env_logger::init();
    info!("Starting container monitor...");

    loop {
        if check_container()? && !check_gui()? {
            error!("GUI process not found, stopping container...");
            Command::new("docker")
                .args(&["kill", "penetration_mode"])
                .output()
                .context("Failed to stop container")?;
            info!("Container stopped due to GUI termination");
            break;
        }
        thread::sleep(Duration::from_secs(5));
    }
    Ok(())
}
