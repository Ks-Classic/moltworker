#!/bin/bash
# Supervise the OpenClaw gateway process and restart it on exit.
set -e

CONFIG_DIR="${CONFIG_DIR:-/root/.openclaw}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/usr/local/lib/openclaw}"
RUNTIME_STATE_FILE="${RUNTIME_STATE_FILE:-/tmp/openclaw-runtime-state.json}"
DESIRED_RUNTIME_FINGERPRINT="${OPENCLAW_DESIRED_RUNTIME_FINGERPRINT:-null}"
RESTART_REASON="${OPENCLAW_RESTART_REASON:-cold-start}"
GATEWAY_LOG_FILE="${GATEWAY_LOG_FILE:-/tmp/openclaw-gateway.log}"

write_runtime_state() {
    node "$SCRIPTS_DIR/write-runtime-state.cjs" "$@"
}

wait_for_gateway_http() {
    local attempts=60
    local i
    for ((i = 1; i <= attempts; i++)); do
        if curl -fsS --max-time 2 "http://127.0.0.1:18789/" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

extract_timestamp() {
    local line="$1"
    if [[ "$line" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2}T[^[:space:]]+) ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi
    return 1
}

start_discord_state_monitor() {
    tail -n 0 -F "$GATEWAY_LOG_FILE" 2>/dev/null | while IFS= read -r line; do
        local timestamp=""
        local lower_line="${line,,}"
        timestamp="$(extract_timestamp "$line" || true)"

        if [[ -n "$timestamp" ]] && [[ "$lower_line" == *"gateway websocket opened"* ]]; then
            write_runtime_state discordReady=true lastDiscordReadyAt="$timestamp" lastDiscordError=null >/dev/null
            continue
        fi

        if [[ -n "$timestamp" ]] && [[ "$lower_line" == *"discord gateway metrics:"* ]]; then
            write_runtime_state discordReady=true lastDiscordHeartbeatAt="$timestamp" lastDiscordError=null >/dev/null
            continue
        fi

        if [[ "$lower_line" == *"discord"* || "$lower_line" == *"gateway websocket"* ]]; then
            if [[ "$lower_line" == *"error"* || "$lower_line" == *"closed"* || "$lower_line" == *"unauthorized"* ]]; then
                local error_line="$line"
                if [[ -n "$timestamp" ]]; then
                    error_line="${line#"$timestamp "}"
                fi
                write_runtime_state discordReady=false lastDiscordError="$error_line" >/dev/null
            fi
        fi
    done &

    echo $!
}

echo "Starting OpenClaw Gateway..."
echo "Gateway will be available on port 18789"
echo "Dev mode: ${OPENCLAW_DEV_MODE:-false}"

cleanup() {
    echo "Received signal, shutting down gateway..."
    kill -- -$$ 2>/dev/null || true
    pkill -f "openclaw gateway" 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT SIGHUP

RESTART_COUNT=0
while true; do
    MONITOR_PID=""
    pkill -f "openclaw gateway" 2>/dev/null || true
    sleep 1
    rm -f /tmp/openclaw-*/gateway.*.lock 2>/dev/null || true
    rm -f /tmp/openclaw-gateway.lock 2>/dev/null || true
    rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true
    touch "$GATEWAY_LOG_FILE"

    if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
        echo "Starting gateway with token auth... (restart #$RESTART_COUNT)"
        write_runtime_state phase=gateway-starting status=starting gatewayStartedAt=now tokenConfigured=true desiredPrimaryModel="${CF_AI_GATEWAY_MODEL:-null}" desiredRuntimeFingerprint="$DESIRED_RUNTIME_FINGERPRINT" lastRestartReason="$RESTART_REASON" gatewayReady=false discordReady=false lastDiscordReadyAt=null lastDiscordHeartbeatAt=null lastDiscordError=null lastError=null >/dev/null
        openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan --token "$OPENCLAW_GATEWAY_TOKEN" > >(tee -a "$GATEWAY_LOG_FILE") 2> >(tee -a "$GATEWAY_LOG_FILE" >&2) &
    else
        echo "Starting gateway with device pairing (no token)... (restart #$RESTART_COUNT)"
        write_runtime_state phase=gateway-starting status=starting gatewayStartedAt=now tokenConfigured=false desiredPrimaryModel="${CF_AI_GATEWAY_MODEL:-null}" desiredRuntimeFingerprint="$DESIRED_RUNTIME_FINGERPRINT" lastRestartReason="$RESTART_REASON" gatewayReady=false discordReady=false lastDiscordReadyAt=null lastDiscordHeartbeatAt=null lastDiscordError=null lastError=null >/dev/null
        openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan > >(tee -a "$GATEWAY_LOG_FILE") 2> >(tee -a "$GATEWAY_LOG_FILE" >&2) &
    fi

    GATEWAY_PID=$!
    MONITOR_PID="$(start_discord_state_monitor)"
    echo "Gateway PID: $GATEWAY_PID"
    if wait_for_gateway_http; then
        write_runtime_state phase=gateway-ready status=ready gatewayPid="$GATEWAY_PID" gatewayReady=true desiredRuntimeFingerprint="$DESIRED_RUNTIME_FINGERPRINT" lastRestartReason="$RESTART_REASON" discordReady=false lastDiscordReadyAt=null lastDiscordHeartbeatAt=null lastDiscordError=null gatewayReadyAt=now lastError=null >/dev/null
    else
        write_runtime_state phase=gateway-timeout status=degraded gatewayPid="$GATEWAY_PID" gatewayReady=false desiredRuntimeFingerprint="$DESIRED_RUNTIME_FINGERPRINT" lastRestartReason="$RESTART_REASON" discordReady=false lastDiscordReadyAt=null lastDiscordHeartbeatAt=null lastDiscordError=null lastError="Gateway did not become HTTP-ready within 60s" >/dev/null
    fi
    set +e
    wait $GATEWAY_PID
    EXIT_CODE=$?
    set -e
    if [ -n "$MONITOR_PID" ]; then
        kill "$MONITOR_PID" 2>/dev/null || true
    fi
    RESTART_COUNT=$((RESTART_COUNT + 1))
    write_runtime_state phase=gateway-exited status=degraded gatewayPid="$GATEWAY_PID" gatewayReady=false desiredRuntimeFingerprint="$DESIRED_RUNTIME_FINGERPRINT" lastRestartReason="$RESTART_REASON" discordReady=false gatewayExitCode="$EXIT_CODE" gatewayExitedAt=now lastError="Gateway exited with code $EXIT_CODE" >/dev/null
    echo "Gateway exited with code $EXIT_CODE (restart #$RESTART_COUNT in 5s)..."
    sleep 5
done
