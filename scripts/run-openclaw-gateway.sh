#!/bin/bash
# Supervise the OpenClaw gateway process and restart it on exit.
set -e

CONFIG_DIR="${CONFIG_DIR:-/root/.openclaw}"

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
    pkill -f "openclaw gateway" 2>/dev/null || true
    sleep 1
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
    set +e
    wait $GATEWAY_PID
    EXIT_CODE=$?
    set -e
    RESTART_COUNT=$((RESTART_COUNT + 1))
    echo "Gateway exited with code $EXIT_CODE (restart #$RESTART_COUNT in 5s)..."
    sleep 5
done
