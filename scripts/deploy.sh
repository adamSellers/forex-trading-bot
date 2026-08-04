#!/bin/bash
# =====================================================
# Forex Trading Bot - Deployment Script (Raspberry Pi)
# Fixed for ARM64 Dependencies + Memory Constraints
# =====================================================

set -Eeuo pipefail

# --- Configuration ---
PROJECT_DIR="/opt/forex-trading-bot"
BACKUP_DIR="${FOREX_BACKUP_DIR:-$HOME/forex-trading-bot-backups}"
APP_NAME="forex-backend"
CONFIG_PATH="backend/data/trading_config.json"
CONFIG_BACKUP=""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "       🚀 FOREX TRADING BOT DEPLOYMENT (Raspberry Pi)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Validation
if [ ! -f "package.json" ]; then
    log_error "Run from project root (/opt/forex-trading-bot)"
    exit 1
fi

if [ "$(whoami)" != "adam" ]; then
    log_error "Please run as user 'adam'"
    exit 1
fi

# Check for secrets
if [ ! -f ".secrets/oanda_api_key.enc" ]; then
    log_warn "Oanda API key not configured. Run: ./scripts/setup-secrets.sh"
fi

# Deploying while orders can be emitted turns a code rollout into a trading
# event. Require an explicit override for emergency hot deploys.
if [ "${ALLOW_LIVE_DEPLOY:-0}" != "1" ] && curl -sf http://localhost:3101/api/health >/tmp/forex-health.json 2>/dev/null; then
    trading_enabled=$(python3 -c 'import json; data=json.load(open("/tmp/forex-health.json")); print(str(bool((data.get("config") or {}).get("enableTrading"))).lower())' 2>/dev/null || echo unknown)
    rm -f /tmp/forex-health.json
    if [ "$trading_enabled" = "true" ]; then
        log_error "Live trading is enabled. Pause it before deployment."
        exit 1
    fi
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    log_error "Tracked working tree changes detected; refusing to overwrite them"
    exit 1
fi

# 0. Backup database BEFORE any git operations (prevents data loss from git reset)
log_info "Creating database backup..."
mkdir -p $BACKUP_DIR
if [ -f "backend/data/trading.db" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    # sqlite3 .backup folds the WAL into a single consistent snapshot — safe
    # while the bot is still running, and avoids storing a multi-GB -wal copy.
    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 -cmd ".timeout 5000" backend/data/trading.db \
            ".backup '$BACKUP_DIR/trading_$TIMESTAMP.db'"
    else
        cp backend/data/trading.db "$BACKUP_DIR/trading_$TIMESTAMP.db"
        # Also backup WAL files if they exist (critical for SQLite integrity)
        cp backend/data/trading.db-wal "$BACKUP_DIR/trading_$TIMESTAMP.db-wal" 2>/dev/null || true
        cp backend/data/trading.db-shm "$BACKUP_DIR/trading_$TIMESTAMP.db-shm" 2>/dev/null || true
    fi
    if command -v sqlite3 >/dev/null 2>&1; then
        integrity=$(sqlite3 "$BACKUP_DIR/trading_$TIMESTAMP.db" "PRAGMA quick_check;")
        [ "$integrity" = "ok" ] || log_error "Database backup integrity check failed"
    fi
    # Keep a configurable recovery window (including legacy WAL/SHM companions)
    while IFS= read -r old_db; do
        rm -f "$old_db" "$old_db-wal" "$old_db-shm"
    done < <(ls -t "$BACKUP_DIR"/trading_*.db 2>/dev/null | tail -n +$((${FOREX_BACKUP_RETENTION:-5} + 1)))
    log_success "Database backed up to $BACKUP_DIR"
else
    log_info "No existing database to backup"
fi

# 0a. Backup runtime config as an additional safety copy.
if [ -f "$CONFIG_PATH" ]; then
    CONFIG_BACKUP=$(mktemp /tmp/forex_trading_config.XXXXXX.json)
    cp "$CONFIG_PATH" "$CONFIG_BACKUP"
    log_info "Runtime trading config backed up"
fi

# 1. Update code from git
log_info "Fetching latest changes from git..."
git fetch origin main
git merge --ff-only origin/main
chmod +x scripts/*.sh

# 1a. Restore runtime config backup if available
if [ -n "$CONFIG_BACKUP" ] && [ -f "$CONFIG_BACKUP" ]; then
    cp "$CONFIG_BACKUP" "$CONFIG_PATH"
    rm -f "$CONFIG_BACKUP"
    log_info "Restored runtime trading config after update"
# 1b. Create config from template if it doesn't exist (fresh install or after untracking)
elif [ ! -f "$CONFIG_PATH" ]; then
    if [ -f "backend/data/trading_config_initial.json" ]; then
        cp backend/data/trading_config_initial.json "$CONFIG_PATH"
        log_info "Created trading_config.json from template"
    fi
fi

# 2. Reproducible dependency install and preflight tests while the old service
# remains online (trading is paused by the guard above).
log_info "Installing backend dependencies from lockfile..."
cd backend
npm ci
log_info "Running backend test suite..."
npm test -- --runInBand
cd ..

# 4. Build frontend (if exists)
if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then
    log_info "Installing frontend dependencies..."
    cd frontend
    npm ci
    cd ..
    
    log_info "Building frontend (memory constrained)..."
    # Pi-specific: Limit heap + disable source maps
    cd frontend
    NODE_OPTIONS="--max-old-space-size=2048" NODE_ENV=production GENERATE_SOURCEMAP=false npm run build
    cd ..
    
    if [ -d "frontend/dist" ]; then
        log_success "Frontend built successfully"
    else
        log_error "Frontend build failed - no dist folder"
        exit 1
    fi
else
    log_info "No frontend to build"
fi

# Remove backend dev dependencies only after the test gate has passed.
(cd backend && npm prune --omit=dev)

# 4. Stop only for the migration/restart cutover.
log_info "Stopping forex services for migration cutover..."
pm2 stop forex-backend --silent 2>/dev/null || true
sleep 2

# 5. Run database migrations
log_info "Running database migrations..."
cd backend
mkdir -p data
mkdir -p logs
if ! npm run db:migrate; then
    log_error "Database migration failed. Aborting deployment."
    exit 1
fi
cd ..

# 6. Restart services
log_info "Starting application..."
pm2 start ecosystem.config.js --env production
pm2 save

# 7. Health check
log_info "Waiting for health check..."
max_attempts=12
attempt=0
sleep 5

while [ $attempt -lt $max_attempts ]; do
    if curl -f -s http://localhost:3101/api/health > /dev/null 2>&1; then
        break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 5
done
echo ""

if [ $attempt -lt $max_attempts ]; then
    if "$SCRIPT_DIR/health-check.sh"; then
        log_success "Comprehensive health check passed!"
    else
        log_error "Comprehensive health check failed"
        pm2 logs forex-backend --lines 40 --nostream
        exit 1
    fi
else
    log_error "Health check did not respond"
    pm2 logs forex-backend --lines 20 --nostream
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
log_success "🎉 Deployment Complete!"
echo ""
echo "Services:"
echo "  Backend:  http://localhost:3101"
echo "  Frontend: http://fx.oakroad"
echo ""
echo "Commands:"
echo "  pm2 logs forex-backend    - View logs"
echo "  pm2 status                - Check status"
echo "  pm2 restart forex-backend - Restart"
echo "═══════════════════════════════════════════════════════════"
