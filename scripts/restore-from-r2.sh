#!/bin/bash
# Restore OpenClaw config, workspace, and skills from R2 via rclone.
# Requires: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CF_ACCOUNT_ID
set -e

CONFIG_DIR="/root/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
WORKSPACE_DIR="/root/clawd"
SKILLS_DIR="/root/clawd/skills"
RCLONE_CONF="/root/.config/rclone/rclone.conf"
R2_BUCKET="${R2_BUCKET_NAME:-openclaw-data}"
RCLONE_FLAGS="--transfers=16 --fast-list --s3-no-check-bucket"

r2_configured() {
    [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$CF_ACCOUNT_ID" ]
}

setup_rclone() {
    mkdir -p "$(dirname "$RCLONE_CONF")"
    cat > "$RCLONE_CONF" << EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = $R2_ACCESS_KEY_ID
secret_access_key = $R2_SECRET_ACCESS_KEY
endpoint = https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF
    touch /tmp/.rclone-configured
    echo "Rclone configured for bucket: $R2_BUCKET"
}

if ! r2_configured; then
    echo "R2 not configured, skipping restore"
    exit 0
fi

setup_rclone

echo "Checking R2 for existing backup..."

# Restore config
if rclone ls "r2:${R2_BUCKET}/openclaw/openclaw.json" $RCLONE_FLAGS 2>/dev/null | grep -q openclaw.json; then
    echo "Restoring config from R2..."
    rclone copy "r2:${R2_BUCKET}/openclaw/" "$CONFIG_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: config restore failed with exit code $?"
    echo "Config restored"
elif rclone ls "r2:${R2_BUCKET}/clawdbot/clawdbot.json" $RCLONE_FLAGS 2>/dev/null | grep -q clawdbot.json; then
    echo "Restoring from legacy R2 backup..."
    rclone copy "r2:${R2_BUCKET}/clawdbot/" "$CONFIG_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: legacy config restore failed with exit code $?"
    if [ -f "$CONFIG_DIR/clawdbot.json" ] && [ ! -f "$CONFIG_FILE" ]; then
        mv "$CONFIG_DIR/clawdbot.json" "$CONFIG_FILE"
    fi
    echo "Legacy config restored and migrated"
else
    echo "No backup found in R2, starting fresh"
fi

# Restore workspace
REMOTE_WS_COUNT=$(rclone ls "r2:${R2_BUCKET}/workspace/" $RCLONE_FLAGS 2>/dev/null | wc -l)
if [ "$REMOTE_WS_COUNT" -gt 0 ]; then
    echo "Restoring workspace from R2 ($REMOTE_WS_COUNT files)..."
    mkdir -p "$WORKSPACE_DIR"
    rclone copy "r2:${R2_BUCKET}/workspace/" "$WORKSPACE_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: workspace restore failed with exit code $?"
    echo "Workspace restored"
fi

# Restore skills
REMOTE_SK_COUNT=$(rclone ls "r2:${R2_BUCKET}/skills/" $RCLONE_FLAGS 2>/dev/null | wc -l)
if [ "$REMOTE_SK_COUNT" -gt 0 ]; then
    echo "Restoring skills from R2 ($REMOTE_SK_COUNT files)..."
    mkdir -p "$SKILLS_DIR"
    rclone copy "r2:${R2_BUCKET}/skills/" "$SKILLS_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: skills restore failed with exit code $?"
    echo "Skills restored"
fi
