#!/bin/bash

# ===================================================
# collect-logs.sh - Collect trading bot logs for analysis
# ===================================================

set -e

LOG_DIR="/opt/crypto-trading-bot/backend/logs"
OUTPUT_FILE="trading_bot_logs_$(date +%Y%m%d_%H%M%S).txt"

echo "🔍 Collecting Crypto Trading Bot Logs..."
echo "=========================================" > "$OUTPUT_FILE"
echo "Generated: $(date)" >> "$OUTPUT_FILE"
echo "=========================================" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# System Information
echo "📊 SYSTEM INFORMATION" >> "$OUTPUT_FILE"
echo "--------------------" >> "$OUTPUT_FILE"
echo "Hostname: $(hostname)" >> "$OUTPUT_FILE"
echo "Uptime: $(uptime)" >> "$OUTPUT_FILE"
echo "PM2 Status:" >> "$OUTPUT_FILE"
pm2 status >> "$OUTPUT_FILE" 2>&1 || echo "PM2 not available" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Application Logs (Last 24 hours)
echo "📋 APPLICATION LOGS (Last 24 hours)" >> "$OUTPUT_FILE"
echo "-----------------------------------" >> "$OUTPUT_FILE"
if [ -d "$LOG_DIR" ]; then
    find "$LOG_DIR" -name "*.log" -mtime -1 -exec cat {} \; | sort >> "$OUTPUT_FILE"
else
    echo "No application logs found in $LOG_DIR" >> "$OUTPUT_FILE"
fi
echo "" >> "$OUTPUT_FILE"

# PM2 Logs (Last 500 lines)
echo "🔧 PM2 LOGS (Last 500 lines)" >> "$OUTPUT_FILE"
echo "-----------------------------" >> "$OUTPUT_FILE"
pm2 logs crypto-trend-bot --lines 500 --nostream >> "$OUTPUT_FILE" 2>&1 || echo "PM2 logs not available" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Trading Specific Events
echo "💰 TRADING EVENTS" >> "$OUTPUT_FILE"
echo "----------------" >> "$OUTPUT_FILE"
if [ -d "$LOG_DIR" ]; then
    grep -h -E "(Signal|Trade|Position|Paper Trading|Portfolio|Balance)" "$LOG_DIR"/*.log 2>/dev/null | sort >> "$OUTPUT_FILE" || echo "No trading events found" >> "$OUTPUT_FILE"
else
    echo "No trading logs available" >> "$OUTPUT_FILE"
fi
echo "" >> "$OUTPUT_FILE"

# Performance Metrics
echo "📈 PERFORMANCE METRICS" >> "$OUTPUT_FILE"
echo "---------------------" >> "$OUTPUT_FILE"
if [ -d "$LOG_DIR" ]; then
    grep -h -E "(Performance|P&L|drawdown|Win rate|Profit factor)" "$LOG_DIR"/*.log 2>/dev/null | sort >> "$OUTPUT_FILE" || echo "No performance metrics found" >> "$OUTPUT_FILE"
else
    echo "No performance logs available" >> "$OUTPUT_FILE"
fi
echo "" >> "$OUTPUT_FILE"

# Error Analysis
echo "❌ ERROR ANALYSIS" >> "$OUTPUT_FILE"
echo "----------------" >> "$OUTPUT_FILE"
if [ -d "$LOG_DIR" ]; then
    grep -h -E "(ERROR|Failed|Error)" "$LOG_DIR"/*.log 2>/dev/null | sort | uniq -c | sort -nr >> "$OUTPUT_FILE" || echo "No errors found" >> "$OUTPUT_FILE"
else
    echo "No error logs available" >> "$OUTPUT_FILE"
fi
echo "" >> "$OUTPUT_FILE"

# Database Status
echo "🗄️ DATABASE STATUS" >> "$OUTPUT_FILE"
echo "------------------" >> "$OUTPUT_FILE"
DB_PATH="/opt/crypto-trading-bot/backend/data/trading.db"
if [ -f "$DB_PATH" ]; then
    echo "Database exists: $DB_PATH" >> "$OUTPUT_FILE"
    echo "Database size: $(du -h "$DB_PATH" | cut -f1)" >> "$OUTPUT_FILE"
    echo "Trade count: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM trades;' 2>/dev/null || echo 'Cannot query')" >> "$OUTPUT_FILE"
    echo "Signal count: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM signals;' 2>/dev/null || echo 'Cannot query')" >> "$OUTPUT_FILE"
else
    echo "Database not found" >> "$OUTPUT_FILE"
fi

echo "" >> "$OUTPUT_FILE"
echo "=========================================" >> "$OUTPUT_FILE"
echo "Log collection completed: $OUTPUT_FILE" >> "$OUTPUT_FILE"
echo "=========================================" >> "$OUTPUT_FILE"

# Summary
echo "✅ Log collection completed!"
echo "📁 Output file: $OUTPUT_FILE"
echo "📊 File size: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo ""
echo "🔄 To analyze with Claude, copy the contents of this file:"
echo "   cat $OUTPUT_FILE"
echo ""
echo "📤 Or transfer to your local machine:"
echo "   scp adam@img.oakroad:/home/adam/$OUTPUT_FILE ."