#!/bin/bash

echo "🚀 Crypto Trading Bot - System Monitor"
echo "======================================"
echo ""

echo "System Info:"
echo "Hostname: $(hostname)"
echo "IP Address: $(hostname -I | awk '{print $1}')"
echo "Uptime: $(uptime -p)"
echo ""

echo "PM2 Status:"
pm2 list
echo ""

echo "Memory Usage:"
free -h
echo ""

echo "Disk Usage:"
df -h /opt/crypto-trading-bot
echo ""

echo "Service Health:"
if pm2 list | grep -q "crypto-trading-bot.*online"; then
    echo "✅ PM2 Process Running"
else
    echo "❌ PM2 Process Failed"
fi

if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ API Responding"
    API_STATUS=$(curl -s http://localhost:3001/health | jq -r '.status' 2>/dev/null || echo "unknown")
    echo "   Status: $API_STATUS"
else
    echo "❌ API Not Responding"
fi

echo ""
echo "Recent Logs:"
tail -n 10 /opt/crypto-trading-bot/backend/logs/combined.log 2>/dev/null || echo "No logs found"