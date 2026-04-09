#!/bin/bash
# Security monitoring daemon — watches for suspicious agent behavior.
# Runs independently of the AI agent in the container.
# Logs to /tmp/security-monitor.log and writes alerts to /tmp/security-alerts.log
# NOTE: Do NOT use set -e — this is a long-running daemon.
# Transient failures (ss, nslookup, grep) must not kill the entire monitor.

LOGFILE=/tmp/security-monitor.log
ALERTFILE=/tmp/security-alerts.log
CHECK_INTERVAL=10  # seconds between checks
WARMUP_SECONDS=60  # skip alerts during startup to avoid false positives

# Allowed outbound domains (must match TOOLS.md)
ALLOWED_DOMAINS=(
    "api.notion.com"
    "discord.com"
    "discordapp.com"
    "generativelanguage.googleapis.com"
    "gateway.ai.cloudflare.com"
    "api.cloudflare.com"
    "open.larksuite.com"
    "open.feishu.cn"
    "api.chatwork.com"
    "api.github.com"
    "api.atlassian.com"
    "atlassian.net"
    "oauth2.googleapis.com"
    "www.googleapis.com"
    "sheets.googleapis.com"
    "calendar-json.googleapis.com"
    "localhost"
    "127.0.0.1"
)

log() {
    echo "[$(date -Iseconds)] $1" >> "$LOGFILE"
}

alert() {
    local msg="[$(date -Iseconds)] 🚨 ALERT: $1"
    echo "$msg" >> "$ALERTFILE"
    echo "$msg" >> "$LOGFILE"
    # Write to a file the agent can read during HEARTBEAT
    echo "$msg" >> /tmp/security-alerts-pending.log
}

is_allowed_domain() {
    local domain="$1"
    for allowed in "${ALLOWED_DOMAINS[@]}"; do
        if [[ "$domain" == "$allowed" || "$domain" == *".$allowed" ]]; then
            return 0
        fi
    done
    return 1
}

# Check 1: Monitor outbound network connections
check_network() {
    # Look for established outbound connections (excluding loopback and known ports)
    local connections
    connections=$(ss -tnp 2>/dev/null | grep ESTAB | grep -v '127.0.0.1' | grep -v '::1' || true)

    if [ -n "$connections" ]; then
        while IFS= read -r line; do
            local remote_addr
            remote_addr=$(echo "$line" | awk '{print $5}' | sed 's/:[0-9]*$//')
            # Resolve if possible, otherwise just log IP
            local resolved
            resolved=$(nslookup "$remote_addr" 2>/dev/null | grep 'name =' | head -1 | awk '{print $NF}' | sed 's/\.$//' || echo "$remote_addr")

            if ! is_allowed_domain "$resolved" && ! is_allowed_domain "$remote_addr"; then
                alert "Unexpected outbound connection to: $resolved ($remote_addr) | $line"
            fi
        done <<< "$connections"
    fi
}

# Check 2: Monitor for env var access attempts in shell history
check_env_access() {
    local history_files=(
        /root/.bash_history
        /root/.zsh_history
        /tmp/.shell_history
    )

    for hfile in "${history_files[@]}"; do
        if [ -f "$hfile" ]; then
            # Check for patterns that could indicate env var exfiltration
            local suspicious
            # Exclude known safe patterns (rclone config, openclaw startup)
            suspicious=$(grep -inE '(printenv|env\b|export|echo.*\$[A-Z_].*KEY|echo.*\$[A-Z_].*TOKEN|echo.*\$[A-Z_].*SECRET|echo.*\$[A-Z_].*PASSWORD|set\b.*\|)' "$hfile" 2>/dev/null | grep -viE '(rclone|openclaw|start-openclaw|patch-config|GOG_ACCOUNT=)' | tail -5 || true)
            if [ -n "$suspicious" ]; then
                alert "Suspicious env access in $hfile: $suspicious"
            fi
        fi
    done
}

# Check 3: Monitor for unexpected file modifications in sensitive dirs
check_file_integrity() {
    local sensitive_files=(
        "/root/.openclaw/agents/main/agent/AGENTS.md"
        "/root/.openclaw/agents/main/agent/TOOLS.md"
    )

    for sfile in "${sensitive_files[@]}"; do
        local checksum_file="/tmp/.integrity-$(echo "$sfile" | md5sum | cut -d' ' -f1)"
        if [ -f "$sfile" ]; then
            local current_hash
            current_hash=$(md5sum "$sfile" | cut -d' ' -f1)
            if [ -f "$checksum_file" ]; then
                local stored_hash
                stored_hash=$(cat "$checksum_file")
                if [ "$current_hash" != "$stored_hash" ]; then
                    alert "CRITICAL: Protected file modified: $sfile"
                fi
            fi
            echo "$current_hash" > "$checksum_file"
        fi
    done
}

# Check 4: Monitor for curl/wget to unknown domains in process list
check_processes() {
    local suspicious_procs
    suspicious_procs=$(ps aux 2>/dev/null | grep -iE '(curl|wget|nc |ncat|netcat)' | grep -v grep || true)

    if [ -n "$suspicious_procs" ]; then
        while IFS= read -r proc; do
            local cmd
            cmd=$(echo "$proc" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}')
            # Extract domain from curl/wget command
            local target_domain
            target_domain=$(echo "$cmd" | grep -oP 'https?://[^/\s]+' | sed 's|https\?://||' || true)

            if [ -n "$target_domain" ] && ! is_allowed_domain "$target_domain"; then
                alert "Unauthorized external request: $cmd"
            fi
        done <<< "$suspicious_procs"
    fi
}

# ── Main loop ──
log "Security monitor started"
log "Allowed domains: ${ALLOWED_DOMAINS[*]}"
log "Warming up for ${WARMUP_SECONDS}s (suppressing alerts)..."

# Wait for container startup to finish before monitoring
sleep "$WARMUP_SECONDS"
log "Warmup complete, monitoring active"

# Initialize file integrity checksums (baseline after startup)
check_file_integrity

CRASH_COUNT=0
while true; do
    # Wrap each check in error handling so one failure doesn't stop others
    check_network || { log "ERROR: check_network failed"; CRASH_COUNT=$((CRASH_COUNT + 1)); }
    check_env_access || { log "ERROR: check_env_access failed"; CRASH_COUNT=$((CRASH_COUNT + 1)); }
    check_file_integrity || { log "ERROR: check_file_integrity failed"; CRASH_COUNT=$((CRASH_COUNT + 1)); }
    check_processes || { log "ERROR: check_processes failed"; CRASH_COUNT=$((CRASH_COUNT + 1)); }

    if [ "$CRASH_COUNT" -gt 100 ]; then
        alert "Security monitor has accumulated $CRASH_COUNT errors, possible issue"
        CRASH_COUNT=0
    fi

    sleep "$CHECK_INTERVAL"
done
