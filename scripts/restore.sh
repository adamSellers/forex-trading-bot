#!/bin/bash
# Stage and verify a paused restore before stopping the current app.
set -Eeuo pipefail
umask 077
PROJECT_DIR="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
BACKUP_DIR="${FOREX_BACKUP_DIR:-$HOME/forex-trading-bot-backups}"
APP_NAME="${FOREX_APP_NAME:-forex-backend}"
API_URL="${FOREX_API_URL:-http://localhost:3101/api}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"
source "$SCRIPT_DIR/load-operator-auth.sh"
fail() { echo "ERROR: $*" >&2; exit 1; }
[ "$#" -ge 1 ] || fail "Usage: restore.sh BACKUP [--verify-only | --confirm RESTORE]"
backup="$1"
shift
verify_only=false
confirmed=false
case "${1:-}" in
    --verify-only) verify_only=true; shift ;;
    --confirm) [ "${2:-}" = RESTORE ] || fail "Confirmation must be RESTORE"; confirmed=true; shift 2 ;;
    '') ;;
    *) fail "Unknown restore option" ;;
esac
[ "$#" -eq 0 ] || fail "Unexpected restore argument"
[ -f "$backup" ] && [ -d "$PROJECT_DIR" ] || fail "Backup and current installation must exist"
mkdir -p "$BACKUP_DIR"
command -v flock >/dev/null || fail "flock is required"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || fail "Backup/restore already running"
stage=$(mktemp -d "$BACKUP_DIR/.restore-stage.XXXXXX")
rollback="${PROJECT_DIR}.rollback.$(date +%Y%m%d_%H%M%S)"
cutover=false
move_installation() {
    if [ -w "$(dirname "$PROJECT_DIR")" ]; then mv "$1" "$2"; else sudo mv "$1" "$2"; fi
}
cleanup() {
    status=$?
    trap - EXIT
    if [ "$status" -ne 0 ] && [ "$cutover" = true ]; then
        pm2 stop "$APP_NAME" --silent >/dev/null 2>&1 || true
        echo "Restore failed after cutover. Runtime remains stopped; original installation/secrets are at $rollback" >&2
    fi
    rm -rf "$stage"
    exit "$status"
}
trap cleanup EXIT
echo "Validating source archive and exact matching SQLite snapshot before changing the installation..."
candidate=$(python3 "$SCRIPT_DIR/restore-stage.py" "$PROJECT_DIR" "$backup" "$stage")
if [ "$verify_only" = true ]; then
    echo "Restore candidate passed archive, schema, snapshot broker-state and SQLite integrity validation. No service was stopped."
    exit 0
fi
load_forex_operator_token || fail "Operator access must be configured before restore"
require_paused_flat() {
    local health broker pid
    python3 "$SCRIPT_DIR/restore-safety.py" "$PROJECT_DIR"
    if health=$(forex_api_curl "$API_URL/health" 2>/dev/null); then
        printf '%s' "$health" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if (d.get("config") or {}).get("enableTrading") is False else 1)' || fail "Running API does not confirm paused entries"
    else
        pid=$(pm2 pid "$APP_NAME" 2>/dev/null | tail -n 1 | tr -d '[:space:]')
        [ "$pid" = 0 ] || fail "API unavailable while PM2 may still be running; establish paused state first"
    fi
    broker=$(forex_broker_account_summary) || fail "Cannot verify broker state directly"
    printf '%s' "$broker" | python3 -c 'import json,sys; a=json.load(sys.stdin).get("account",{}); sys.exit(0 if str(a.get("openTradeCount")) == "0" and str(a.get("pendingOrderCount")) == "0" else 1)' || fail "Broker has open trades, pending orders, or unknown state"
}
require_paused_flat
if [ "$confirmed" != true ]; then
    read -r -p "Type RESTORE to install this validated, paused candidate: " answer
    [ "$answer" = RESTORE ] || fail "Restore cancelled"
fi
# Prepare only the staged candidate while the existing service remains paused.
(cd "$candidate/backend" && npm ci --omit=dev)
if [ -f "$candidate/frontend/package.json" ]; then
    (cd "$candidate/frontend" && npm ci && NODE_OPTIONS="--max-old-space-size=2048" NODE_ENV=production npm run build)
fi
(cd "$candidate/backend" && DB_PATH="$candidate/backend/data/trading.db" NODE_ENV=production npm run db:migrate)
python3 "$SCRIPT_DIR/restore-stage.py" --verify-db "$candidate/backend/data/trading.db"
python3 -c 'import os,sys; sys.exit(0 if os.stat(sys.argv[1]).st_dev == os.stat(sys.argv[2]).st_dev else "Staging and installation must share a filesystem for atomic moves")' "$candidate" "$(dirname "$PROJECT_DIR")"
require_paused_flat
[ ! -e "$rollback" ] || fail "Rollback directory already exists"
echo "Cutover: preserving the entire original installation at $rollback"
pm2 stop "$APP_NAME" --silent >/dev/null
cutover=true
move_installation "$PROJECT_DIR" "$rollback"
move_installation "$candidate" "$PROJECT_DIR"
(cd "$PROJECT_DIR" && pm2 start ecosystem.config.js --env production)
pm2 save
for _attempt in $(seq 1 12); do
    forex_api_curl "$API_URL/health" >/dev/null 2>&1 && break
    sleep 5
done
health=$(forex_api_curl "$API_URL/health") || fail "Restored API failed to start"
printf '%s' "$health" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if (d.get("config") or {}).get("enableTrading") is False else 1)' || fail "Restored API did not remain paused"
"$PROJECT_DIR/scripts/health-check.sh" || fail "Restored operational health failed"
cutover=false
echo "Restore completed and remains paused. Original installation/secrets preserved at $rollback"
echo "Review RESTORE_MANIFEST.json, broker reconciliation, operational health and Git source state before separate live activation."
