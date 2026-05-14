#!/bin/bash
# =====================================================
# Forex Trading Bot - Health Check Script
# Used by monitoring systems and manual checks
# =====================================================

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
if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    log_message "✅ API Health: HEALTHY"
    
    # Get additional info
    health_data=$(curl -s "http://localhost:$PORT/api/health" 2>/dev/null)
    if [ -n "$health_data" ]; then
        engine_status=$(echo "$health_data" | grep -o '"enableTrading":[^,}]*' | cut -d: -f2 || echo "unknown")
        log_message "   Trading Enabled: $engine_status"
    fi
else
    log_message "❌ API Health: FAILED"
    FAILED=1
fi

engine_status=$(curl -sf "http://localhost:$PORT/api/engine/status" 2>/dev/null || true)
if [ -n "$engine_status" ]; then
    timesfm_status=$(echo "$engine_status" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tf = data.get('timesFm') or {}
    enabled = tf.get('enabled') is True and tf.get('mode') != 'disabled'
    configured = tf.get('configured') is True
    connected = tf.get('connected') is True
    mode = str(tf.get('mode') or 'disabled').upper()
    device = tf.get('device') or 'unknown'
    failure = tf.get('lastFailureReason') or 'none'

    if not enabled:
        print('DISABLED')
        print(f'mode={mode}')
    elif not configured:
        print('WARNING')
        print(f'mode={mode}')
        print('reason=not_configured')
    elif connected:
        print('OK')
        print(f'mode={mode}')
        print(f'device={device}')
    else:
        print('WARNING')
        print(f'mode={mode}')
        print(f'reason={failure}')
except Exception:
    print('WARNING')
    print('reason=unparseable')
" 2>/dev/null)

    tf_result=$(echo "$timesfm_status" | head -n1)
    tf_details=$(echo "$timesfm_status" | tail -n +2)

    if [ "$tf_result" = "OK" ]; then
        log_message "✅ TimesFM Sidecar: HEALTHY"
    elif [ "$tf_result" = "DISABLED" ]; then
        log_message "ℹ️  TimesFM Sidecar: DISABLED"
    else
        log_message "⚠️  TimesFM Sidecar: DEGRADED (fail-open)"
    fi

    while IFS= read -r line; do
        [ -n "$line" ] && log_message "   $line"
    done <<< "$tf_details"
fi

# Check shared runtime selection and paired shadow run
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
    shadow_run = live.get('shadowRun') or {}
    candidates = [
        run for run in runs
        if run.get('mode') == 'paper_candidate' and run.get('status') == 'active'
    ]
    managing = [
        run for run in runs
        if run.get('mode') == 'live' and run.get('status') == 'managing_only'
    ]

    errors = []
    if not live_run.get('runId'):
        errors.append('live selection missing')
    if not shadow_run.get('runId'):
        errors.append('paired shadow run missing')
    elif shadow_run.get('shadowOfRunId') != live_run.get('runId'):
        errors.append('shadow run is not paired to the active live run')

    if errors:
        print('FAIL')
        for error in errors:
            print(error)
    else:
        print('OK')
        print(f\"strategy={live.get('strategy') or 'unknown'}\")
        print(f\"liveRun={short(live_run.get('runId'))}\")
        print(f\"shadowRun={short(shadow_run.get('runId'))}\")
        print(f\"selectionId={short(live.get('selectionId'))}\")
        print(f\"candidateRuns={len(candidates)}\")
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
    if sqlite3 "$DB_PATH" "SELECT 1;" > /dev/null 2>&1; then
        log_message "✅ Database: HEALTHY"
        
        # Get trade counts
        trade_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM trades;" 2>/dev/null || echo "?")
        log_message "   Total Trades: $trade_count"
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
    oanda_check=$(curl -sf "http://localhost:$PORT/api/account" 2>/dev/null)
    if [ -n "$oanda_check" ]; then
        log_message "✅ Oanda API: CONNECTED"
    else
        log_message "⚠️  Oanda API: NOT VERIFIED"
    fi
fi

exit $FAILED
