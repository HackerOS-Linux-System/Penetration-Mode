#!/bin/bash

LOG_FILE="tmp/penetration_mode.log"
echo "Installing Penetration Mode on HackerOS..." | tee -a "$LOG_FILE"

# Create logs directory
mkdir -p logs

# Install dependencies
sudo apt update
sudo apt install -y python3 python3-pip docker.io build-essential
pip3 install PyQt6

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Build Rust components
cd backend/kontenerator
cargo build --release
cd ../monitor
cargo build --release
cd ../..

# Set permissions
chmod +x scripts/*.sh
chmod +x backend/kontenerator/target/release/kontenerator
chmod +x backend/monitor/target/release/monitor

# Create tmpfs volume
docker volume create penetration_mode_tmpfs

# Copy .desktop file
sudo cp penetration-mode.desktop /usr/share/applications/

# Start monitor in background
nohup backend/monitor/target/release/monitor >> "$LOG_FILE" 2>&1 &

echo "Installation completed successfully!" | tee -a "$LOG_FILE"
