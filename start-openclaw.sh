#!/bin/bash
# OpenClaw startup orchestrator.
# Calls individual scripts for each phase: restore → patch → sync → launch.
set -e

SCRIPTS_DIR="/usr/local/lib/openclaw"

if pgrep -f "openclaw gateway" > /dev/null 2>&1; then
    echo "OpenClaw gateway is already running, exiting."
    exit 0
else
    # Remove stale locks left behind by a dead gateway process
    rm -f /tmp/openclaw-*/gateway.*.lock 2>/dev/null || true
fi

CONFIG_DIR="/root/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
AGENT_STATE_DIR="$CONFIG_DIR/agents/main/agent"

echo "Config directory: $CONFIG_DIR"
mkdir -p "$CONFIG_DIR"

# ── Phase 1: Restore from R2 ──────────────────────────────
"$SCRIPTS_DIR/restore-from-r2.sh"

# ── Phase 2: Clean stale agent state ──────────────────────
# OpenClaw regenerates these from config + env at startup.
mkdir -p "$AGENT_STATE_DIR"
rm -f "$AGENT_STATE_DIR/auth-profiles.json" "$AGENT_STATE_DIR/models.json"

# ── Phase 2.5: Restore gog config (Google Workspace) ─────
GOG_CONFIG_SRC="$CONFIG_DIR/gog-config"
GOG_CONFIG_DST="/root/.config/gogcli"
if [ -d "$GOG_CONFIG_SRC" ]; then
    echo "Restoring gog config from R2..."
    mkdir -p "$GOG_CONFIG_DST/keyring"
    cp -a "$GOG_CONFIG_SRC/"* "$GOG_CONFIG_DST/" 2>/dev/null || true
    if [ -d "$GOG_CONFIG_SRC/keyring" ]; then
        cp -a "$GOG_CONFIG_SRC/keyring/"* "$GOG_CONFIG_DST/keyring/" 2>/dev/null || true
    fi
    echo "gog config restored"
else
    echo "No gog config found in R2, skipping"
fi

# ── Phase 3: Onboard (first run only) ────────────────────
if [ ! -f "$CONFIG_FILE" ]; then
    echo "No existing config found, running openclaw onboard..."

    AUTH_ARGS=""
    if [ -n "$CLOUDFLARE_AI_GATEWAY_API_KEY" ] && [ -n "$CF_AI_GATEWAY_ACCOUNT_ID" ] && [ -n "$CF_AI_GATEWAY_GATEWAY_ID" ]; then
        AUTH_ARGS="--auth-choice cloudflare-ai-gateway-api-key \
            --cloudflare-ai-gateway-account-id $CF_AI_GATEWAY_ACCOUNT_ID \
            --cloudflare-ai-gateway-gateway-id $CF_AI_GATEWAY_GATEWAY_ID \
            --cloudflare-ai-gateway-api-key $CLOUDFLARE_AI_GATEWAY_API_KEY"
    elif [ -n "$ANTHROPIC_API_KEY" ]; then
        AUTH_ARGS="--auth-choice apiKey --anthropic-api-key $ANTHROPIC_API_KEY"
    elif [ -n "$OPENAI_API_KEY" ]; then
        AUTH_ARGS="--auth-choice openai-api-key --openai-api-key $OPENAI_API_KEY"
    fi

    openclaw onboard --non-interactive --accept-risk \
        --mode local \
        $AUTH_ARGS \
        --gateway-port 18789 \
        --gateway-bind lan \
        --skip-channels \
        --skip-skills \
        --skip-health

    echo "Onboard completed"
else
    echo "Using existing config"
fi

# ── Phase 4: Patch config ─────────────────────────────────
node "$SCRIPTS_DIR/patch-config.cjs"

# ── Phase 4.5: Auto-fix config (safety net) ──────────────
# Remove any unrecognized keys that would cause validation errors.
# This prevents gateway crashes from stale R2 data or patch-config bugs.
echo "Running openclaw doctor --fix..."
openclaw doctor --fix 2>&1 || echo "Warning: openclaw doctor --fix failed (non-fatal)"

# ── Phase 5: Background sync ─────────────────────────────
if [ -f /tmp/.rclone-configured ]; then
    echo "Starting background R2 sync loop..."
    "$SCRIPTS_DIR/sync-loop.sh" &
    echo "Background sync loop started (PID: $!)"
fi

# ── Phase 5.5: Security monitoring daemon ─────────────────
if [ -f "$SCRIPTS_DIR/security-monitor.sh" ]; then
    echo "Starting security monitor daemon..."
    bash "$SCRIPTS_DIR/security-monitor.sh" &
    echo "Security monitor started (PID: $!)"
fi

# ── Phase 6: Start gateway ────────────────────────────────
echo "Starting OpenClaw Gateway..."
echo "Gateway will be available on port 18789"

echo "Dev mode: ${OPENCLAW_DEV_MODE:-false}"

# Cleanup handler: kill child gateway process when this script is terminated
# (e.g. by Worker's process.kill() via /api/admin/gateway/restart)
cleanup() {
    echo "Received signal, shutting down gateway..."
    # Kill all child processes in our process group
    kill -- -$$ 2>/dev/null || true
    # Also kill any openclaw gateway by name
    pkill -f "openclaw gateway" 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT SIGHUP

# Restart loop: if the gateway crashes (e.g. unhandled promise rejection),
# wait 5 seconds and restart it. This keeps the Discord bot alive.
RESTART_COUNT=0
while true; do
    # Kill any leftover gateway process and clean locks before (re)starting
    pkill -f "openclaw gateway" 2>/dev/null || true
    sleep 1
    # OpenClaw stores its lock at /tmp/openclaw-<N>/gateway.<hash>.lock
    rm -f /tmp/openclaw-*/gateway.*.lock 2>/dev/null || true
    rm -f /tmp/openclaw-gateway.lock 2>/dev/null || true
    rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true

    if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
        echo "Starting gateway with token auth... (restart #$RESTART_COUNT)"
        openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan --token "$OPENCLAW_GATEWAY_TOKEN" &
    else
        echo "Starting gateway with device pairing (no token)... (restart #$RESTART_COUNT)"
        openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan &
    fi

    GATEWAY_PID=$!
    echo "Gateway PID: $GATEWAY_PID"
    wait $GATEWAY_PID
    EXIT_CODE=$?
    RESTART_COUNT=$((RESTART_COUNT + 1))
    echo "Gateway exited with code $EXIT_CODE (restart #$RESTART_COUNT in 5s)..."
    sleep 5
done
