#!/bin/bash

echo "📊 Production Status Check"
echo "=========================="

echo "🖥️ System Info:"
echo "  Uptime: $(uptime -p)"
echo "  Memory: $(free -h | grep Mem | awk '{print $3"/"$2}')"
echo "  Disk: $(df -h /opt/crypto-trading-bot | tail -1 | awk '{print $3"/"$2" ("$5" used)"}')"
echo

echo "🔧 PM2 Status:"
pm2 jlist 2>/dev/null | jq -r '.[] | "  \(.name): \(.pm2_env.status) (CPU: \(.monit.cpu)%, Memory: \(.monit.memory/1024/1024 | floor)MB)"' 2>/dev/null || pm2 list
echo

echo "🌐 Nginx Status:"
if systemctl is-active --quiet nginx; then
    echo "  Status: ✅ Running"
else
    echo "  Status: ❌ Stopped"
fi
echo

echo "🩺 Health Check:"
if curl -f -s http://localhost:3001/api/management/health > /dev/null; then
    echo "  API: ✅ Responding"
    health_data=$(curl -s http://localhost:3001/api/management/health)
    echo "  Uptime: $(echo $health_data | jq -r '.uptime' | awk '{printf "%.1f hours", $1/3600}')"
else
    echo "  API: ❌ Not responding"
fi

if curl -f -s -k https://localhost/ > /dev/null; then
    echo "  HTTPS: ✅ Responding"
else
    echo "  HTTPS: ❌ Not responding"
fi