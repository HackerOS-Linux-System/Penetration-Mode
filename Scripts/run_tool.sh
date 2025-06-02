#!/bin/bash
TOOL=$1
LOG_FILE="tmp/penetration_mode.log"

if [ -z "$TOOL" ]; then
    echo "Error: Tool name required" | tee -a "$LOG_FILE"
    exit 1
fi

echo "Running tool: $TOOL" | tee -a "$LOG_FILE"
docker exec -u kali penetration_mode $TOOL
if [ $? -ne 0 ]; then
    echo "Error: Failed to run $TOOL" | tee -a "$LOG_FILE"
    exit 1
fi
