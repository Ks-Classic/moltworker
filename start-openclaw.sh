#!/bin/bash
# OpenClaw startup orchestrator.
# Delegates bootstrap and gateway supervision to focused scripts.
set -e

SCRIPTS_DIR="/usr/local/lib/openclaw"
CONFIG_DIR="/root/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
CONFIG_SOURCE_FILE="$CONFIG_DIR/openclaw.source.json"
CONFIG_OVERRIDES_FILE="$CONFIG_DIR/openclaw.overrides.json"
AGENT_STATE_DIR="$CONFIG_DIR/agents/main/agent"

if pgrep -f "openclaw gateway" > /dev/null 2>&1; then
    echo "OpenClaw gateway is already running, exiting."
    exit 0
else
    # Remove stale locks left behind by a dead gateway process
    rm -f /tmp/openclaw-*/gateway.*.lock 2>/dev/null || true
fi

export SCRIPTS_DIR CONFIG_DIR CONFIG_FILE CONFIG_SOURCE_FILE CONFIG_OVERRIDES_FILE AGENT_STATE_DIR

"$SCRIPTS_DIR/bootstrap-openclaw.sh"
exec "$SCRIPTS_DIR/run-openclaw-gateway.sh"
