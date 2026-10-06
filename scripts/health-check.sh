#!/bin/bash
# Read-only operational check. Expected market closures and risk cooldowns are
# healthy; unavailable broker truth or unsafe position management fails closed.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh" || exit 1
source "$SCRIPT_DIR/load-maintenance-api.sh" || exit 1
FOREX_PROJECT_DIR="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
LOG_FILE="$FOREX_PROJECT_DIR/backend/logs/health.log"
PORT="${PORT:-3101}"
FAILED=0

log_message() {
    printf '%s\n' "$1"
    if [ -d "$(dirname "$LOG_FILE")" ]; then
        printf '%s - %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE" 2>/dev/null || true
    fi
}

pm2_data=$(pm2 jlist 2>/dev/null || true)
if printf '%s' "$pm2_data" | node "$SCRIPT_DIR/maintenance-tools.cjs" pm2-online 2>/dev/null; then
    log_message "PM2: healthy"
else
    log_message "PM2: forex-backend is not verified online"
    FAILED=1
fi

system_data=$(forex_api_curl "http://localhost:$PORT/api/system/health" 2>/dev/null || true)
if [ -z "$system_data" ]; then
    log_message "Operational health: API unavailable"
    FAILED=1
else
    if ! details=$(printf '%s' "$system_data" | node "$SCRIPT_DIR/maintenance-tools.cjs" operational-health 2>/dev/null); then
        FAILED=1
        log_message "${details:-Operational health payload could not be verified}"
    else
        log_message "$details"
    fi
fi

# An unavailable or degraded runtime already fails this check. Avoid taking a
# long SQLite read lock while it is still starting or trying to recover.
if [ "$FAILED" -ne 0 ]; then
    log_message "Database: verification deferred until the runtime is operationally healthy"
    exit 1
fi

DB_PATH="$FOREX_PROJECT_DIR/backend/data/trading.db"
if [ ! -f "$DB_PATH" ]; then
    log_message "Database: missing"
    exit 1
fi

# Bound the entire read-only database phase, including all lifecycle queries.
# The Node helper bounds its sqlite3 subprocess; no extra timeout utility is needed.
database_details=$(node "$SCRIPT_DIR/maintenance-tools.cjs" database-health "$DB_PATH") || FAILED=1
log_message "$database_details"

exit "$FAILED"
