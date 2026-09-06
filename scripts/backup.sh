#!/bin/bash
# Safe, single-instance backup for the live-only forex bot.

set -Eeuo pipefail

APP_NAME="${FOREX_APP_NAME:-forex-backend}"
PROJECT_DIR="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
BACKUP_DIR="${FOREX_BACKUP_DIR:-$HOME/forex-trading-bot-backups}"
API_URL="${FOREX_API_URL:-http://localhost:3101/api}"
MAX_KEEP="${FOREX_BACKUP_RETENTION:-3}"
BACKUP_TIMEOUT_SECONDS="${FOREX_BACKUP_TIMEOUT_SECONDS:-1800}"
TIMESTAMP="${FOREX_BACKUP_TIMESTAMP:-$(date +"%Y%m%d_%H%M%S")}"
BACKUP_FILE="forex_backup_${TIMESTAMP}.tar.gz"
BACKUP_MODE="${1:---safe}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"
source "$SCRIPT_DIR/load-operator-auth.sh"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}info  $*${NC}"; }
log_warn() { echo -e "${YELLOW}warn  $*${NC}"; }
log_success() { echo -e "${GREEN}done  $*${NC}"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

case "$MAX_KEEP" in
    ''|*[!0-9]*) fail "FOREX_BACKUP_RETENTION must be a positive integer" ;;
esac
[ "$MAX_KEEP" -gt 0 ] || fail "FOREX_BACKUP_RETENTION must be greater than zero"
case "$BACKUP_TIMEOUT_SECONDS" in
    ''|*[!0-9]*) fail "FOREX_BACKUP_TIMEOUT_SECONDS must be a positive integer" ;;
esac
[ "$BACKUP_TIMEOUT_SECONDS" -gt 0 ] || fail "FOREX_BACKUP_TIMEOUT_SECONDS must be greater than zero"
case "$BACKUP_MODE" in
    --safe|--archive-only) ;;
    *) fail "Unknown backup mode: $BACKUP_MODE" ;;
esac

mkdir -p "$BACKUP_DIR"

command -v flock >/dev/null 2>&1 || fail "flock is required for safe backups"
command -v timeout >/dev/null 2>&1 || fail "timeout is required for bounded backups"
command -v sqlite3 >/dev/null 2>&1 || fail "sqlite3 is required for consistent backups"

# The lock is held by this shell for its full lifetime. A cron invocation that
# overlaps an existing backup exits successfully without creating any files.
LOCK_FILE="${FOREX_BACKUP_LOCK_FILE:-$BACKUP_DIR/.backup.lock}"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log_warn "Another forex backup is already running; skipping this invocation"
    if [ "${FOREX_BACKUP_REQUIRE_RUN:-0}" = 1 ]; then
        exit 75
    fi
    exit 0
fi

ARCHIVE_FINAL="$BACKUP_DIR/$BACKUP_FILE"
ARCHIVE_PARTIAL="$ARCHIVE_FINAL.partial"
DB_FINAL="$BACKUP_DIR/trading_${TIMESTAMP}.db"
DB_PARTIAL="$DB_FINAL.partial"
SERVICE_STOPPED=false
TRADING_WAS_ENABLED=false
TRADING_PAUSED=false

api_json_field() {
    local json="$1"
    local expression="$2"
    printf '%s' "$json" | python3 -c \
        "import json,sys; data=json.load(sys.stdin); print($expression)"
}

wait_for_api() {
    local attempt
    for attempt in $(seq 1 18); do
        if forex_api_curl -sf --max-time 10 "$API_URL/health" >/dev/null 2>&1; then
            return 0
        fi
        sleep 5
    done
    return 1
}

enable_live_trading() {
    local attempt
    for attempt in $(seq 1 18); do
        if forex_api_curl -sf --max-time 20 -X POST "$API_URL/trading/start" >/dev/null; then
            return 0
        fi
        sleep 5
    done
    return 1
}

restore_runtime() {
    local failed=false

    if [ "$SERVICE_STOPPED" = true ]; then
        log_info "Restarting $APP_NAME after snapshot"
        if pm2 start "$APP_NAME" --env production >/dev/null 2>&1 && wait_for_api; then
            SERVICE_STOPPED=false
        else
            echo "ERROR: failed to restart $APP_NAME after backup" >&2
            failed=true
        fi
    fi

    if [ "$TRADING_PAUSED" = true ] && [ "$TRADING_WAS_ENABLED" = true ]; then
        if [ "$SERVICE_STOPPED" = false ] && enable_live_trading; then
            TRADING_PAUSED=false
            log_info "Restored readiness-gated live trading"
        else
            echo "ERROR: failed to restore live trading after backup" >&2
            failed=true
        fi
    fi

    [ "$failed" = false ]
}

cleanup() {
    local status=$?
    trap - EXIT INT TERM
    rm -f "$ARCHIVE_PARTIAL" "$DB_PARTIAL" "$DB_PARTIAL-journal"
    if ! restore_runtime; then
        status=1
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

list_by_mtime() {
    # Backup-controlled names contain no whitespace, so ls is safe here. The
    # explicit fallback keeps an empty glob harmless under set -e/pipefail.
    ls -1t -- "$@" 2>/dev/null || true
}

prune_simple_files() {
    local count=0
    local file
    while IFS= read -r file; do
        [ -n "$file" ] || continue
        count=$((count + 1))
        if [ "$count" -gt "$MAX_KEEP" ]; then
            rm -f "$file"
        fi
    done < <(list_by_mtime "$@")
}

prune_database_files() {
    local count=0
    local file
    while IFS= read -r file; do
        [ -n "$file" ] || continue
        count=$((count + 1))
        if [ "$count" -gt "$MAX_KEEP" ]; then
            rm -f "$file" "$file-wal" "$file-shm" "$file-journal"
        fi
    done < <(list_by_mtime "$BACKUP_DIR"/trading_*.db)
}

prune_backups() {
    prune_simple_files "$BACKUP_DIR"/forex_backup_*.tar.gz
    prune_simple_files "$BACKUP_DIR"/pre_restore_*.tar.gz
    prune_simple_files "$BACKUP_DIR"/pre_restore_*.db
    prune_database_files
}

remove_stale_partials() {
    local file
    while IFS= read -r file; do
        [ -n "$file" ] || continue
        rm -f "$file" "$file-journal"
    done < <(find "$BACKUP_DIR" -maxdepth 1 -type f \
        \( -name '*.partial' -o -name '*.partial-journal' \) \
        -mmin +60 -print 2>/dev/null || true)
}

quiesce_database() {
    local health account broker open_trades pid_output service_pid trading_enabled

    pid_output=$(pm2 pid "$APP_NAME" 2>/dev/null) || \
        fail "cannot inspect PM2 state before database snapshot"
    service_pid=$(printf '%s\n' "$pid_output" | tail -n 1 | tr -cd '0-9')
    [ -n "$service_pid" ] || fail "PM2 returned an invalid process id for $APP_NAME"
    if [ "$service_pid" -eq 0 ]; then
        log_info "$APP_NAME is already stopped; snapshotting the quiet database"
        return 0
    fi
    health=$(forex_api_curl -sf --max-time 10 "$API_URL/health") || \
        fail "cannot inspect runtime health before database snapshot"
    trading_enabled=$(api_json_field "$health" \
        "str(bool((data.get('config') or {}).get('enableTrading'))).lower()") || \
        fail "cannot parse live trading state before database snapshot"
    case "$trading_enabled" in
        true|false) ;;
        *) fail "runtime returned an invalid live trading state" ;;
    esac
    if [ "$trading_enabled" = true ]; then
        TRADING_WAS_ENABLED=true
        forex_api_curl -sf --max-time 20 -X POST "$API_URL/trading/stop" >/dev/null || \
            fail "could not pause new entries before database snapshot"
        TRADING_PAUSED=true
        log_info "Paused new entries for consistent database snapshot"
    fi

    # Pausing entries must be durable, and a flat broker summary alone cannot
    # exclude an unresolved in-flight submission. Keep management running when
    # the local lifecycle ledger still records uncertainty.
    python3 "$SCRIPT_DIR/restore-safety.py" "$PROJECT_DIR" || \
        fail "database snapshot deferred because pause or durable broker state is unresolved"

    # Broker truth is checked after pausing entries and inspecting the ledger.
    account=$(forex_api_curl -sf --max-time 20 "$API_URL/account") || \
        fail "cannot verify broker positions before database snapshot"
    open_trades=$(api_json_field "$account" "int(data.get('openTrades', -1))") || \
        fail "cannot parse broker position count before database snapshot"
    [ "$open_trades" -eq 0 ] || \
        fail "database snapshot deferred because broker reports $open_trades open trade(s)"
    # Check pending broker orders directly as well. This also works during the
    # first auth rollout when the old /account API has no pendingOrders field.
    broker=$(forex_broker_account_summary) || fail "cannot verify pending broker orders before snapshot"
    printf '%s' "$broker" | python3 -c \
        'import json,sys; a=json.load(sys.stdin).get("account",{}); sys.exit(0 if str(a.get("openTradeCount")) == "0" and str(a.get("pendingOrderCount")) == "0" else 1)' || \
        fail "database snapshot deferred because broker account is not confirmed flat with zero pending orders"

    log_info "Stopping $APP_NAME while the flat database is snapshotted"
    SERVICE_STOPPED=true
    pm2 stop "$APP_NAME" --silent >/dev/null
    sleep 2
}

create_archive() {
    log_info "Creating atomic source archive"
    tar -czf "$ARCHIVE_PARTIAL" \
        --exclude='node_modules' \
        --exclude='frontend/node_modules' \
        --exclude='backend/node_modules' \
        --exclude='*.log' \
        --exclude='backend/logs/*' \
        --exclude='frontend/dist' \
        --exclude='backend/data/trading.db*' \
        --exclude='.git' \
        --exclude='.env' \
        --exclude='*/.env' \
        --exclude='.keys' \
        --exclude='.secrets' \
        --exclude='ssl' \
        --exclude='*.pem' \
        --exclude='*.key' \
        --exclude='*.crt' \
        -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")"
    gzip -t "$ARCHIVE_PARTIAL"
    mv "$ARCHIVE_PARTIAL" "$ARCHIVE_FINAL"
    log_success "Source archive: $ARCHIVE_FINAL"
}

create_database_snapshot() {
    local database="$PROJECT_DIR/backend/data/trading.db"
    local integrity
    [ -f "$database" ] || {
        log_warn "No database found at $database; skipping database snapshot"
        return 0
    }

    quiesce_database
    log_info "Creating bounded SQLite snapshot"
    timeout --signal=TERM --kill-after=30s "$BACKUP_TIMEOUT_SECONDS" \
        sqlite3 -cmd ".timeout 5000" "$database" ".backup '$DB_PARTIAL'"

    # The source only needs to remain quiet while SQLite copies it. Bring the
    # runtime back before checking the immutable snapshot so daily downtime is
    # limited to the copy rather than the slower full-file integrity scan.
    restore_runtime || fail "runtime restoration failed after database copy"

    integrity=$(timeout --signal=TERM --kill-after=30s "$BACKUP_TIMEOUT_SECONDS" \
        sqlite3 -readonly "$DB_PARTIAL" "PRAGMA quick_check;")
    [ "$integrity" = ok ] || fail "database snapshot integrity check failed"
    mv "$DB_PARTIAL" "$DB_FINAL"
    log_success "Verified database snapshot: $DB_FINAL"
}

echo "Forex Trading Bot backup: $TIMESTAMP"
remove_stale_partials

# Retention runs before expensive work as well as afterwards. This bounds disk
# usage even when the previous invocation was interrupted before housekeeping.
log_info "Applying pre-backup retention (keep $MAX_KEEP)"
prune_backups
create_archive

if [ "$BACKUP_MODE" = "--safe" ]; then
    create_database_snapshot
else
    log_warn "Archive-only mode selected; no database snapshot was created"
fi

log_info "Applying post-backup retention (keep $MAX_KEEP)"
prune_backups
echo "$(date): Backup completed - $BACKUP_FILE" >> "$BACKUP_DIR/backup.log"

log_success "Backup complete"
df -h "$BACKUP_DIR" | tail -n 1
