#!/bin/bash
# =====================================================
# Forex Trading Bot - Status Dashboard
# Quick overview of system and trading status
# =====================================================

APP_NAME="forex-backend"
PORT=3101

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"
source "$SCRIPT_DIR/load-operator-auth.sh"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}         💱 FOREX TRADING BOT - STATUS DASHBOARD${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# System Info
echo -e "${BLUE}📊 System Info:${NC}"
echo "  Hostname: $(hostname)"
echo "  IP Address: $(hostname -I 2>/dev/null | awk '{print $1}' || echo 'N/A')"
echo "  Uptime: $(uptime -p 2>/dev/null || uptime)"
echo ""

# Memory
echo -e "${BLUE}💾 Memory:${NC}"
free -h | grep -E "^Mem:" | awk '{print "  Total: " $2 " | Used: " $3 " | Available: " $7}'
echo ""

# Disk
echo -e "${BLUE}💿 Disk:${NC}"
df -h /opt/forex-trading-bot 2>/dev/null | tail -1 | awk '{print "  Used: " $3 "/" $2 " (" $5 " full)"}'
echo ""

# PM2 Status
echo -e "${BLUE}🔧 PM2 Services:${NC}"
pm2 list 2>/dev/null | grep -E "forex" || echo "  No PM2 services found"
echo ""

# Service Health
echo -e "${BLUE}🩺 Service Health:${NC}"

# PM2 Process
if pm2 list 2>/dev/null | grep -q "$APP_NAME.*online"; then
    echo -e "  PM2 Process:    ${GREEN}✅ Running${NC}"
    
    # Get memory from PM2
    mem_info=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for app in data:
        if app.get('name') == '$APP_NAME':
            mem = app.get('monit', {}).get('memory', 0)
            cpu = app.get('monit', {}).get('cpu', 0)
            print(f'  Resource Usage:  CPU: {cpu}% | Memory: {mem//1024//1024}MB')
            break
except: pass
" 2>/dev/null)
    [ -n "$mem_info" ] && echo "$mem_info"
else
    echo -e "  PM2 Process:    ${RED}❌ Not Running${NC}"
fi

# API Health
if forex_api_curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    echo -e "  API Health:     ${GREEN}✅ Responding${NC}"
    
    # Get health data
    health=$(forex_api_curl -s "http://localhost:$PORT/api/health" 2>/dev/null)
    if [ -n "$health" ]; then
        trading_enabled=$(echo "$health" | grep -o '"enableTrading":[^,}]*' | cut -d: -f2)
        
        if [ "$trading_enabled" = "true" ]; then
            echo -e "  Trading:        ${GREEN}✅ ENABLED (live)${NC}"
        else
            echo -e "  Trading:        ${YELLOW}⏸️  DISABLED${NC}"
        fi
    fi
else
    echo -e "  API Health:     ${RED}❌ Not Responding${NC}"
fi

# Database
DB_PATH="/opt/forex-trading-bot/backend/data/trading.db"
if [ -f "$DB_PATH" ]; then
    if sqlite3 "$DB_PATH" "SELECT 1;" > /dev/null 2>&1; then
        echo -e "  Database:       ${GREEN}✅ OK${NC}"
        db_size=$(du -h "$DB_PATH" 2>/dev/null | cut -f1)
        echo "  DB Size:        $db_size"
    else
        echo -e "  Database:       ${RED}❌ Error${NC}"
    fi
else
    echo -e "  Database:       ${YELLOW}⚠️  Not Found${NC}"
fi

# Nginx
if systemctl is-active --quiet nginx 2>/dev/null; then
    echo -e "  Nginx:          ${GREEN}✅ Running${NC}"
else
    echo -e "  Nginx:          ${YELLOW}⚠️  Not Running${NC}"
fi

echo ""

# Runtime status
if forex_api_curl -sf "http://localhost:$PORT/api/runtime/live-selection" > /dev/null 2>&1; then
    echo -e "${BLUE}🧠 Runtime Status:${NC}"

    runtime=$(forex_api_curl -s "http://localhost:$PORT/api/runtime/live-selection" 2>/dev/null)
    runtime_info=$(echo "$runtime" | python3 -c "
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

    print(f\"  Strategy:       {live.get('strategy') or 'n/a'}\")
    print(f\"  Selection ID:   {short(live.get('selectionId'))}\")
    print(
        f\"  Live Run:       {short(live_run.get('runId'))} \"
        f\"({live_run.get('status') or 'unknown'})\"
    )
    print(f\"  Managing Only:  {len(managing)} live run(s)\")
except Exception:
    pass
" 2>/dev/null)
    [ -n "$runtime_info" ] && echo "$runtime_info"
    echo ""
fi

# Trading Stats (if API is up)
if forex_api_curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    echo -e "${BLUE}📈 Trading Status:${NC}"
    
    # Get engine status
    engine=$(forex_api_curl -s "http://localhost:$PORT/api/engine/status" 2>/dev/null)
    if [ -n "$engine" ]; then
        signals=$(echo "$engine" | grep -o '"signalsReceived":[0-9]*' | cut -d: -f2)
        trades=$(echo "$engine" | grep -o '"tradesExecuted":[0-9]*' | cut -d: -f2)
        open=$(echo "$engine" | grep -o '"openTrades":\[[^]]*\]' | tr -cd ',' | wc -c)
        open=$((open + 1))
        [ "$open" = "1" ] && open=$(echo "$engine" | grep -o '"openTrades":\[\]' > /dev/null && echo 0 || echo 1)
        
        echo "  Signals Received: ${signals:-0}"
        echo "  Trades Executed:  ${trades:-0}"
        echo "  Open Positions:   ${open:-0}"
    fi
    
    # Get account info
    account=$(forex_api_curl -s "http://localhost:$PORT/api/account" 2>/dev/null)
    if [ -n "$account" ]; then
        balance=$(echo "$account" | grep -o '"balance":"[^"]*"' | cut -d'"' -f4)
        unrealized=$(echo "$account" | grep -o '"unrealizedPL":"[^"]*"' | cut -d'"' -f4)
        
        if [ -n "$balance" ]; then
            echo ""
            echo -e "${BLUE}💰 Account:${NC}"
            echo "  Balance:     $balance AUD"
            [ -n "$unrealized" ] && echo "  Unrealized:  $unrealized AUD"
        fi
    fi
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo "  Dashboard: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
echo "  Logs:      pm2 logs $APP_NAME"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
