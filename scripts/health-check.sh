#!/bin/bash
LOG_FILE="/opt/crypto-trading-bot/backend/logs/health.log"

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> $LOG_FILE
}

FAILED=0

# Check PM2 process
if pm2 list | grep -q "crypto-trading-bot.*online"; then
    log_message "✅ Process: HEALTHY"
else
    log_message "❌ Process: FAILED"
    FAILED=1
fi

# Check API health
if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    log_message "✅ API: HEALTHY"
else
    log_message "❌ API: FAILED"
    FAILED=1
fi

# Check database
if sqlite3 "/opt/crypto-trading-bot/backend/data/trading.db" "SELECT 1;" > /dev/null 2>&1; then
    log_message "✅ Database: HEALTHY"
else
    log_message "❌ Database: FAILED"
    FAILED=1
fi

exit $FAILED