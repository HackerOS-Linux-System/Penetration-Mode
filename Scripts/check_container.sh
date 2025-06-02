#!/bin/bash
LOG_FILE="tmp/penetration_mode.log"

if docker ps -q -f name=penetration_mode > /dev/null; then
    echo "Container is running" | tee -a "$LOG_FILE"
    exit 0
else
    echo "Container is not running" | tee -a "$LOG_FILE"
    exit 1
fi
