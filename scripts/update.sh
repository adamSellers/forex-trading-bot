#!/bin/bash
# =====================================================
# Forex Trading Bot - Lightweight Update Script
# Pulls latest changes, conditionally rebuilds, restarts.
# Preserves database and runtime config. Use for quick code pushes.
# =====================================================

set -e

# --- Configuration ---
APP_NAME="forex-backend"
PROJECT_DIR="/opt/forex-trading-bot"
BRANCH="main"

# --- Colors ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "       ⚡ FOREX BOT - QUICK UPDATE"
echo "═══════════════════════════════════════════════════════════"
echo ""

cd "$PROJECT_DIR" || log_error "Project directory $PROJECT_DIR not found."

# 1. Backup database BEFORE any git operations (prevents data loss from git reset)
BACKUP_DIR="$HOME/forex-backups"
MAX_DB_BACKUPS=5
CONFIG_PATH="backend/data/trading_config.json"
CONFIG_BACKUP=""

prune_db_backups() {
    local max_keep="$1"
    local delete_from=$((max_keep + 1))
    local old_backups=()

    mapfile -t old_backups < <(ls -t "$BACKUP_DIR"/trading_*.db 2>/dev/null | tail -n +"$delete_from")

    if [ "${#old_backups[@]}" -eq 0 ]; then
        return
    fi

    for old_db in "${old_backups[@]}"; do
        rm -f "$old_db" "$old_db-wal" "$old_db-shm"
    done

    log_info "Pruned ${#old_backups[@]} old database backup(s); keeping max ${max_keep}"
}

log_info "Creating database backup..."
mkdir -p "$BACKUP_DIR"
if [ -f "backend/data/trading.db" ]; then
    # Free space before copying the multi-GB SQLite DB. After the new backup is
    # created, prune again so the retention cap is always enforced.
    prune_db_backups $((MAX_DB_BACKUPS - 1))

    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    cp backend/data/trading.db "$BACKUP_DIR/trading_$TIMESTAMP.db"
    # Also backup WAL files if they exist (critical for SQLite integrity)
    cp backend/data/trading.db-wal "$BACKUP_DIR/trading_$TIMESTAMP.db-wal" 2>/dev/null || true
    cp backend/data/trading.db-shm "$BACKUP_DIR/trading_$TIMESTAMP.db-shm" 2>/dev/null || true
    prune_db_backups "$MAX_DB_BACKUPS"
    log_success "Database backed up to $BACKUP_DIR"
else
    log_info "No existing database to backup"
fi

# 1a. Backup runtime config so local live settings survive git reset
if [ -f "$CONFIG_PATH" ]; then
    CONFIG_BACKUP=$(mktemp /tmp/forex_trading_config.XXXXXX.json)
    cp "$CONFIG_PATH" "$CONFIG_BACKUP"
    log_info "Runtime trading config backed up"
fi

# 2. Fetch latest changes
log_info "Fetching latest changes from origin..."
git fetch origin

# 3. Get current and remote commit hashes
before_hash=$(git rev-parse HEAD)
after_hash=$(git rev-parse "origin/$BRANCH")

# 4. Reset to match remote
log_warn "Resetting local branch to match remote 'origin/$BRANCH'..."
git reset --hard "origin/$BRANCH"
chmod +x scripts/*.sh 2>/dev/null || true

# 4a. Restore runtime config backup if available
if [ -n "$CONFIG_BACKUP" ] && [ -f "$CONFIG_BACKUP" ]; then
    cp "$CONFIG_BACKUP" "$CONFIG_PATH"
    rm -f "$CONFIG_BACKUP"
    log_info "Restored runtime trading config after update"
# 4b. Create config from template if it doesn't exist (fresh install or after untracking)
elif [ ! -f "$CONFIG_PATH" ]; then
    if [ -f "backend/data/trading_config_initial.json" ]; then
        cp backend/data/trading_config_initial.json "$CONFIG_PATH"
        log_info "Created trading_config.json from template"
    fi
fi

if [ "$before_hash" == "$after_hash" ]; then
    log_success "Already up-to-date. No new code to deploy."
    exit 0
fi

log_success "Code updated: ${before_hash:0:7} → ${after_hash:0:7}"

# 4. Analyze what changed
log_info "Analyzing changes..."
changed_files=$(git diff --name-only "$before_hash" "$after_hash")

backend_changed=false
frontend_changed=false
deps_changed=false

if echo "$changed_files" | grep -q -E "^backend/"; then
    backend_changed=true
    log_info "  Backend changes detected"
fi
if echo "$changed_files" | grep -q -E "^frontend/"; then
    frontend_changed=true
    log_info "  Frontend changes detected"
fi
if echo "$changed_files" | grep -q -E "package.json|package-lock.json"; then
    deps_changed=true
    log_info "  Dependency changes detected"
fi

# 5. Install dependencies if needed
if [ "$deps_changed" = true ]; then
    log_info "Installing backend dependencies..."
    cd backend
    npm install --omit=dev
    cd ..
    
    if [ -d "frontend" ]; then
        log_info "Installing frontend dependencies..."
        cd frontend
        npm install
        cd ..
    fi
    log_success "Dependencies updated"
fi

# 6. Build frontend if needed
if [ "$frontend_changed" = true ] || [ "$deps_changed" = true ]; then
    if [ -d "frontend" ]; then
        log_info "Rebuilding frontend..."
        cd frontend
        
        # ARM64 Rollup fix for Raspberry Pi
        npm install @rollup/rollup-linux-arm64-gnu --no-save 2>/dev/null || true
        
        # Memory constrained build
        NODE_OPTIONS="--max-old-space-size=2048" NODE_ENV=production GENERATE_SOURCEMAP=false npm run build
        cd ..
        log_success "Frontend rebuilt"
    fi
else
    log_info "No frontend changes, skipping build"
fi

# 7. Run database migrations
log_info "Running database migrations..."
cd backend
if ! NODE_ENV=production npm run db:migrate; then
    log_error "Database migration failed. Aborting update."
fi
cd ..

# 8. Graceful reload using ecosystem config (FIXED: --env requires ecosystem file)
log_info "Reloading application..."
pm2 reload ecosystem.config.js --env production 2>/dev/null || pm2 restart ecosystem.config.js --env production
pm2 save

# 9. Health check
log_info "Health check..."
sleep 3
if curl -sf http://localhost:3101/api/health > /dev/null 2>&1; then
    log_success "Health check passed!"
else
    log_warn "Health check failed - checking logs..."
    pm2 logs $APP_NAME --lines 10 --nostream
fi

echo ""
log_success "🎉 Quick update complete!"
pm2 status | grep -E "(forex)" || pm2 status
