#!/bin/bash
# =====================================================
# Forex Trading Bot - Health Check Script
# Used by monitoring systems and manual checks
# =====================================================

set -uo pipefail

LOG_FILE="/opt/forex-trading-bot/backend/logs/health.log"
APP_NAME="forex-backend"
PORT=3101
FAILED=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE" 2>/dev/null
    echo "$1"
}

# Check PM2 process
if pm2 list | grep -q "$APP_NAME.*online"; then
    log_message "✅ PM2 Process: HEALTHY"
else
    log_message "❌ PM2 Process: FAILED"
    FAILED=1
fi

# Check API health endpoint
health_data=$(curl -sf "http://localhost:$PORT/api/health" 2>/dev/null || true)
if [ -n "$health_data" ]; then
    log_message "✅ API Health: HEALTHY"

    if [ -n "$health_data" ]; then
        engine_status=$(printf '%s' "$health_data" | python3 -c \
            'import json,sys; data=json.load(sys.stdin); print(str(bool((data.get("config") or {}).get("enableTrading"))).lower())' \
            2>/dev/null || echo unknown)
        log_message "   Trading Enabled: $engine_status"
    fi
else
    log_message "❌ API Health: FAILED"
    FAILED=1
fi

# A failed readiness gate is expected while paused, but is critical if entries
# are enabled. A bounded consecutive-loss cooldown is a healthy safety state,
# not an infrastructure failure.
if [ "${engine_status:-unknown}" = "true" ]; then
    readiness_data=$(curl -sf "http://localhost:$PORT/api/trading/live-readiness" 2>/dev/null || true)
    readiness_passed=$(printf '%s' "$readiness_data" | python3 -c \
        'import json,sys; print(str(json.load(sys.stdin).get("passed") is True).lower())' \
        2>/dev/null || echo false)
    readiness_status=$(printf '%s' "$readiness_data" | python3 -c \
        'import json,sys; print(str(json.load(sys.stdin).get("status") or "UNKNOWN"))' \
        2>/dev/null || echo UNKNOWN)
    if [ "$readiness_passed" = "true" ]; then
        log_message "✅ Live Readiness: PASSED"
    elif [ "$readiness_status" = "COOLDOWN" ]; then
        log_message "⚠️ Live Entry State: CONSECUTIVE-LOSS COOLDOWN"
    else
        log_message "❌ Live Readiness: FAILED WHILE TRADING ENABLED"
        FAILED=1
    fi
fi

# Check the sole live runtime selection.
if [ $FAILED -eq 0 ]; then
    runtime_data=$(curl -sf "http://localhost:$PORT/api/runtime/live-selection" 2>/dev/null || true)

    if [ -n "$runtime_data" ]; then
        runtime_status=$(echo "$runtime_data" | python3 -c "
import sys, json

def short(value):
    value = str(value or '')
    return value[:12] if value else 'n/a'

try:
    data = json.load(sys.stdin)
    live = data.get('liveSelection') or {}
    runs = data.get('runs') or []
    live_run = live.get('liveRun') or {}
    managing = [
        run for run in runs
        if run.get('mode') == 'live' and run.get('status') == 'managing_only'
    ]

    errors = []
    if not live_run.get('runId'):
        errors.append('live selection missing')
    if live.get('strategy') != 'intraday_momentum':
        errors.append('unexpected live strategy')
    if live_run.get('mode') != 'live' or live_run.get('status') != 'active':
        errors.append('live run is not active')

    if errors:
        print('FAIL')
        for error in errors:
            print(error)
    else:
        print('OK')
        print(f\"strategy={live.get('strategy') or 'unknown'}\")
        print(f\"liveRun={short(live_run.get('runId'))}\")
        print(f\"selectionId={short(live.get('selectionId'))}\")
        print(f\"managingOnly={len(managing)}\")
except Exception:
    print('FAIL')
    print('runtime payload could not be parsed')
" 2>/dev/null)

        runtime_result=$(echo "$runtime_status" | head -n1)
        runtime_details=$(echo "$runtime_status" | tail -n +2)

        if [ "$runtime_result" = "OK" ]; then
            log_message "✅ Runtime Selection: HEALTHY"
            while IFS= read -r line; do
                [ -n "$line" ] && log_message "   $line"
            done <<< "$runtime_details"
        else
            log_message "❌ Runtime Selection: FAILED"
            while IFS= read -r line; do
                [ -n "$line" ] && log_message "   $line"
            done <<< "$runtime_details"
            FAILED=1
        fi
    else
        log_message "❌ Runtime Selection: NOT VERIFIED"
        FAILED=1
    fi
fi

# Check database
DB_PATH="/opt/forex-trading-bot/backend/data/trading.db"
if [ -f "$DB_PATH" ]; then
    if [ "$(sqlite3 "$DB_PATH" "PRAGMA quick_check;" 2>/dev/null)" = "ok" ]; then
        log_message "✅ Database: HEALTHY"
        
        # Get trade counts
        trade_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM trades;" 2>/dev/null || echo "?")
        log_message "   Total Trades: $trade_count"

        lifecycle_tables=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('broker_order_intents','broker_position_quarantines');" 2>/dev/null || echo 0)
        if [ "$lifecycle_tables" = "2" ]; then
            stale_cutoff=$(( $(date +%s) * 1000 - 10 * 60 * 1000 ))
            stale_intents=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM broker_order_intents WHERE status IN ('PREPARED','SUBMITTING','AMBIGUOUS','RECOVERY_PENDING','FILLED_UNPERSISTED') AND created_at_ms < $stale_cutoff;" 2>/dev/null || echo 0)
            quarantines=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM broker_position_quarantines WHERE status='OPEN';" 2>/dev/null || echo 0)
            if [ "$stale_intents" -gt 0 ] || [ "$quarantines" -gt 0 ]; then
                log_message "❌ Broker Lifecycle: ${stale_intents} stale intent(s), ${quarantines} quarantined position(s)"
                FAILED=1
            else
                log_message "✅ Broker Lifecycle: RESOLVED"
            fi
        else
            log_message "❌ Broker Lifecycle: SCHEMA MISSING"
            FAILED=1
        fi
    else
        log_message "❌ Database: CORRUPTED"
        FAILED=1
    fi
else
    log_message "❌ Database: NOT FOUND"
    FAILED=1
fi

# Check memory usage
if command -v pm2 &> /dev/null; then
    mem_usage=$(pm2 jlist 2>/dev/null | grep -o '"memory":[0-9]*' | head -1 | cut -d: -f2)
    if [ -n "$mem_usage" ]; then
        mem_mb=$((mem_usage / 1024 / 1024))
        log_message "   Memory Usage: ${mem_mb}MB"
    fi
fi

# Check Oanda connectivity (if API is up)
if [ $FAILED -eq 0 ]; then
    oanda_check=$(curl -sf "http://localhost:$PORT/api/account" 2>/dev/null || true)
    if [ -n "$oanda_check" ]; then
        log_message "✅ Oanda API: CONNECTED"
    else
        log_message "⚠️  Oanda API: NOT VERIFIED"
    fi
fi

exit $FAILED
