#!/bin/bash
# =====================================================
# Forex Trading Bot - Log Viewer
# Quick access to various log sources
# =====================================================

APP_NAME="forex-backend"
LOG_DIR="/opt/forex-trading-bot/backend/logs"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"

case "$1" in
    ""|"pm2")
        echo "📋 PM2 Logs (live):"
        pm2 logs "$APP_NAME" --lines 50
        ;;
    "tail")
        echo "📋 Following PM2 logs..."
        pm2 logs "$APP_NAME"
        ;;
    "app")
        echo "📋 Application Logs:"
        if [ -f "$LOG_DIR/combined.log" ]; then
            tail -100 "$LOG_DIR/combined.log"
        else
            echo "No combined.log found"
        fi
        ;;
    "error")
        echo "📋 Error Logs:"
        if [ -f "$LOG_DIR/error.log" ]; then
            tail -100 "$LOG_DIR/error.log"
        else
            echo "No error.log found"
        fi
        ;;
    "trades")
        echo "📋 Recent Trade Activity:"
        if [ -f "$LOG_DIR/combined.log" ]; then
            grep -iE "(trade|signal|position|entry|exit|buy|sell)" "$LOG_DIR/combined.log" | tail -50
        else
            pm2 logs "$APP_NAME" --lines 200 --nostream | grep -iE "(trade|signal|position|entry|exit|buy|sell)" | tail -50
        fi
        ;;
    "runtime")
        echo "📋 Shared Runtime Activity:"
        if [ -f "$LOG_DIR/combined.log" ]; then
            grep -iE "(runtime|shadow|candidate|selection|ownerRunId|runId|managing_only)" "$LOG_DIR/combined.log" | tail -80
        else
            pm2 logs "$APP_NAME" --lines 300 --nostream | grep -iE "(runtime|shadow|candidate|selection|ownerRunId|runId|managing_only)" | tail -80
        fi
        ;;
    "errors")
        echo "📋 Recent Errors:"
        pm2 logs "$APP_NAME" --lines 500 --nostream | grep -iE "(error|failed|exception)" | tail -30
        ;;
    "clear")
        echo "🗑️  Clearing PM2 logs..."
        pm2 flush "$APP_NAME"
        echo "✅ Logs cleared"
        ;;
    *)
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  (none)  - Show last 50 lines of PM2 logs"
        echo "  tail    - Follow PM2 logs live"
        echo "  app     - Show application combined.log"
        echo "  error   - Show error.log"
        echo "  trades  - Filter for trade-related entries"
        echo "  runtime - Filter for runtime/shadow/candidate activity"
        echo "  errors  - Filter for error entries"
        echo "  clear   - Clear PM2 logs"
        ;;
esac
