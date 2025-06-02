#!/bin/bash
LOG_FILE="logs/penetration_mode.log"

echo "Installing tools in container..." | tee -a "$LOG_FILE"
docker exec -u root penetration_mode apt update
docker exec -u root penetration_mode apt install -y kali-linux-default
if [ $? -ne 0 ]; then
    echo "Error: Failed to install tools" | tee -a "$LOG_FILE"
    exit 1
fi
echo "Tools installed successfully" | tee -a "$LOG_FILE"
