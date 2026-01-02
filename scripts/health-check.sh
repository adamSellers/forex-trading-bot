#!/bin/bash
# =====================================================
# Forex Trading Bot - Health Check Script
# Used by monitoring systems and manual checks
# =====================================================

LOG_FILE="/opt/forex-trading-bot/backend/logs/health.log"
APP_NAME="forex-backend"
PORT=3101
FAILED=0

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
