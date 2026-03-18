#!/bin/bash
# OpenClaw startup orchestrator.
# Calls individual scripts for each phase: restore → patch → sync → launch.
set -e

SCRIPTS_DIR="/usr/local/lib/openclaw"

if pgrep -f "openclaw gateway" > /dev/null 2>&1; then
    echo "OpenClaw gateway is already running, exiting."
    exit 0
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
node "$SCRIPTS_DIR/patch-config.js"

# ── Phase 5: Background sync ─────────────────────────────
if [ -f /tmp/.rclone-configured ]; then
    echo "Starting background R2 sync loop..."
    "$SCRIPTS_DIR/sync-loop.sh" &
    echo "Background sync loop started (PID: $!)"
fi

# ── Phase 6: Start gateway ────────────────────────────────
echo "Starting OpenClaw Gateway..."
echo "Gateway will be available on port 18789"

rm -f /tmp/openclaw-gateway.lock 2>/dev/null || true
rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true

echo "Dev mode: ${OPENCLAW_DEV_MODE:-false}"

# Restart loop: if the gateway crashes (e.g. unhandled promise rejection),
# wait 5 seconds and restart it. This keeps the Discord bot alive.
RESTART_COUNT=0
while true; do
    rm -f /tmp/openclaw-gateway.lock 2>/dev/null || true
    rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true

    if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
        echo "Starting gateway with token auth... (restart #$RESTART_COUNT)"
        openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan --token "$OPENCLAW_GATEWAY_TOKEN"
    else
        echo "Starting gateway with device pairing (no token)... (restart #$RESTART_COUNT)"
        openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan
    fi

    EXIT_CODE=$?
    RESTART_COUNT=$((RESTART_COUNT + 1))
    echo "Gateway exited with code $EXIT_CODE (restart #$RESTART_COUNT in 5s)..."
    sleep 5
done
