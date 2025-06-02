#!/bin/bash
LOG_FILE="tmp/penetration_mode.log"

echo "Cleaning up resources..." | tee -a "$LOG_FILE"
docker kill penetration_mode 2>/dev/null
docker volume rm penetration_mode_tmpfs 2>/dev/null
echo "Cleanup completed" | tee -a "$LOG_FILE"
