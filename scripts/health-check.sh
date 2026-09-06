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
if printf '%s' "$pm2_data" | python3 -c '
import json,sys
processes=json.load(sys.stdin)
sys.exit(0 if any(p.get("name")=="forex-backend" and (p.get("pm2_env") or {}).get("status")=="online" for p in processes) else 1)
' 2>/dev/null; then
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
    if ! details=$(printf '%s' "$system_data" | python3 -c '
import json,sys,time
data=json.load(sys.stdin)
health=data.get("operationalHealth") or {}
errors=[]
if (data.get("services") or {}).get("oanda",{}).get("connected") is not True:
    errors.append("Broker connectivity is not verified")
checked=health.get("checkedAt")
if not isinstance(checked,(int,float)) or checked > time.time()*1000+10000 or time.time()*1000-checked > 180000:
    errors.append("Operational snapshot is missing or stale")
if health.get("status") != "healthy":
    errors.append("Operational state is not healthy")
for issue in health.get("issues") or []:
    errors.append(str(issue.get("message") or issue.get("code") or "Unknown operational issue"))
live=data.get("liveSelection") or {}
run=live.get("liveRun") or {}
if not run.get("runId") or live.get("strategy") != "intraday_momentum" or run.get("mode") != "live" or run.get("status") != "active":
    errors.append("Canonical live runtime selection is not verified")
if (data.get("config") or {}).get("enableTrading") is True:
    readiness=data.get("liveReadiness") or {}
    if readiness.get("passed") is not True and readiness.get("status") != "COOLDOWN":
        errors.append("Live readiness failed while entries are enabled")
if errors:
    print("\n".join(dict.fromkeys(errors)))
    sys.exit(1)
print("Operational health: healthy")
print("Entry state: "+str(health.get("entryState") or "unknown"))
print("Broker: connected and recently reconciled")
' 2>/dev/null); then
        FAILED=1
        log_message "${details:-Operational health payload could not be verified}"
    else
        log_message "$details"
    fi
fi

DB_PATH="$FOREX_PROJECT_DIR/backend/data/trading.db"
if [ ! -f "$DB_PATH" ]; then
    log_message "Database: missing"
    FAILED=1
elif [ "$(sqlite3 -readonly "$DB_PATH" 'PRAGMA quick_check;' 2>/dev/null)" != "ok" ]; then
    log_message "Database: integrity could not be verified"
    FAILED=1
else
    log_message "Database: integrity verified"
    cutoff=$(( $(date +%s) * 1000 - 10 * 60 * 1000 ))
    if ! pending=$(sqlite3 -readonly "$DB_PATH" "SELECT COUNT(*) FROM broker_order_intents WHERE status IN ('PREPARED','SUBMITTING','AMBIGUOUS','RECOVERY_PENDING','FILLED_UNPERSISTED') AND created_at_ms < $cutoff;" 2>/dev/null) ||
       ! quarantined=$(sqlite3 -readonly "$DB_PATH" "SELECT COUNT(*) FROM broker_position_quarantines WHERE status='OPEN';" 2>/dev/null) ||
       [[ ! "$pending" =~ ^[0-9]+$ ]] || [[ ! "$quarantined" =~ ^[0-9]+$ ]]; then
        log_message "Broker lifecycle: database state could not be verified"
        FAILED=1
    elif [ "$pending" -gt 0 ] || [ "$quarantined" -gt 0 ]; then
        log_message "Broker lifecycle: $pending unresolved stale intent(s), $quarantined quarantined position(s)"
        FAILED=1
    else
        log_message "Broker lifecycle: resolved"
    fi
fi

exit "$FAILED"
