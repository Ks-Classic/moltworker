#!/bin/bash
# Prepare runtime state and configuration before the gateway starts.
set -e

SCRIPTS_DIR="${SCRIPTS_DIR:-/usr/local/lib/openclaw}"
CONFIG_DIR="${CONFIG_DIR:-/root/.openclaw}"
CONFIG_FILE="${CONFIG_FILE:-$CONFIG_DIR/openclaw.json}"
CONFIG_SOURCE_FILE="${CONFIG_SOURCE_FILE:-$CONFIG_DIR/openclaw.source.json}"
CONFIG_OVERRIDES_FILE="${CONFIG_OVERRIDES_FILE:-$CONFIG_DIR/openclaw.overrides.json}"
AGENT_STATE_DIR="${AGENT_STATE_DIR:-$CONFIG_DIR/agents/main/agent}"

echo "Config directory: $CONFIG_DIR"
mkdir -p "$CONFIG_DIR"

# Phase 1: Restore from R2
"$SCRIPTS_DIR/restore-from-r2.sh"

# Phase 2: Clean stale agent state
mkdir -p "$AGENT_STATE_DIR"
rm -f "$AGENT_STATE_DIR/auth-profiles.json" "$AGENT_STATE_DIR/models.json"

# Phase 2.5: Restore gog config
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

# Phase 3: Seed/build config source
if [ -f "$SCRIPTS_DIR/openclaw.source.json" ]; then
    echo "Applying bundled source config (deploy-time)..."
    cp "$SCRIPTS_DIR/openclaw.source.json" "$CONFIG_SOURCE_FILE"
elif [ ! -f "$CONFIG_SOURCE_FILE" ]; then
    if [ -f "$CONFIG_FILE" ]; then
        echo "Seeding source config from existing openclaw.json..."
        cp "$CONFIG_FILE" "$CONFIG_SOURCE_FILE"
    fi
fi

# Phase 3.5: Onboard (first run only)
if [ ! -f "$CONFIG_FILE" ] && [ ! -f "$CONFIG_SOURCE_FILE" ]; then
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
    elif [ -n "$OPENROUTER_API_KEY" ]; then
        AUTH_ARGS="--auth-choice apiKey --token-provider openrouter --token $OPENROUTER_API_KEY"
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

# Phase 4: Build config from source + overrides
if [ -f "$CONFIG_SOURCE_FILE" ]; then
    echo "Building effective config from source + overrides..."
    OPENCLAW_SOURCE_PATH="$CONFIG_SOURCE_FILE" \
    OPENCLAW_OVERRIDES_PATH="$CONFIG_OVERRIDES_FILE" \
    OPENCLAW_OUTPUT_PATH="$CONFIG_FILE" \
    node "$SCRIPTS_DIR/build-openclaw-config.cjs"
fi

# Phase 4.5: Patch config
node "$SCRIPTS_DIR/patch-config.cjs"

# Phase 5: Auto-fix config
echo "Running openclaw doctor --fix..."
openclaw doctor --fix 2>&1 || echo "Warning: openclaw doctor --fix failed (non-fatal)"

# Phase 6: Background sync
if [ -f /tmp/.rclone-configured ]; then
    echo "Starting background R2 sync loop..."
    "$SCRIPTS_DIR/sync-loop.sh" &
    echo "Background sync loop started (PID: $!)"
fi

# Phase 6.5: Security monitoring daemon
if [ -f "$SCRIPTS_DIR/security-monitor.sh" ]; then
    echo "Starting security monitor daemon..."
    bash "$SCRIPTS_DIR/security-monitor.sh" &
    echo "Security monitor started (PID: $!)"
fi
