#!/bin/bash
# Background R2 sync loop — uploads local changes to R2 every 30 seconds.
# Requires: rclone already configured (run restore-from-r2.sh first)
set -e

CONFIG_DIR="/root/.openclaw"
WORKSPACE_DIR="/root/clawd"
SKILLS_DIR="/root/clawd/skills"
R2_BUCKET="${R2_BUCKET_NAME:-openclaw-data}"
RCLONE_FLAGS="--transfers=16 --fast-list --s3-no-check-bucket"
LAST_SYNC_FILE="/tmp/.last-sync"

MARKER=/tmp/.last-sync-marker
LOGFILE=/tmp/r2-sync.log
touch "$MARKER"

while true; do
    sleep 30

    CHANGED=/tmp/.changed-files
    {
        find "$CONFIG_DIR" -newer "$MARKER" -type f -printf '%P\n' 2>/dev/null
        find "$WORKSPACE_DIR" -newer "$MARKER" \
            -not -path '*/node_modules/*' \
            -not -path '*/.git/*' \
            -type f -printf '%P\n' 2>/dev/null
    } > "$CHANGED"

    COUNT=$(wc -l < "$CHANGED" 2>/dev/null || echo 0)

    if [ "$COUNT" -gt 0 ]; then
        echo "[sync] Uploading changes ($COUNT files) at $(date)" >> "$LOGFILE"
        rclone sync "$CONFIG_DIR/" "r2:${R2_BUCKET}/openclaw/" \
            $RCLONE_FLAGS --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' --exclude='.git/**' \
            --exclude='agents/main/agent/auth-profiles.json' --exclude='agents/main/agent/models.json' 2>> "$LOGFILE"
        if [ -d "$WORKSPACE_DIR" ]; then
            rclone sync "$WORKSPACE_DIR/" "r2:${R2_BUCKET}/workspace/" \
                $RCLONE_FLAGS --exclude='skills/**' --exclude='.git/**' --exclude='node_modules/**' 2>> "$LOGFILE"
        fi
        if [ -d "$SKILLS_DIR" ]; then
            rclone sync "$SKILLS_DIR/" "r2:${R2_BUCKET}/skills/" \
                $RCLONE_FLAGS 2>> "$LOGFILE"
        fi
        date -Iseconds > "$LAST_SYNC_FILE"
        touch "$MARKER"
        echo "[sync] Complete at $(date)" >> "$LOGFILE"
    fi
done
