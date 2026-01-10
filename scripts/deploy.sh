#!/bin/bash
# =====================================================
# Forex Trading Bot - Deployment Script (Raspberry Pi)
# Fixed for ARM64 Dependencies + Memory Constraints
# =====================================================

set -e

# --- Configuration ---
PROJECT_DIR="/opt/forex-trading-bot"
BACKUP_DIR="$HOME/forex-backups"
APP_NAME="forex-backend"

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

# 0. Backup database BEFORE any git operations (prevents data loss from git reset)
log_info "Creating database backup..."
mkdir -p $BACKUP_DIR
if [ -f "backend/data/trading.db" ]; then
    cp backend/data/trading.db "$BACKUP_DIR/trading_$(date +%Y%m%d_%H%M%S).db"
    # Keep only last 7 backups
    ls -t $BACKUP_DIR/trading_*.db 2>/dev/null | tail -n +8 | xargs -r rm
    log_success "Database backed up to $BACKUP_DIR"
else
    log_info "No existing database to backup"
fi

# 1. Update code from git
log_info "Fetching latest changes from git..."
git fetch origin main
git reset --hard origin/main
chmod +x scripts/*.sh

# 2. Stop Service
log_info "Stopping forex services..."
pm2 stop forex-backend --silent 2>/dev/null || true
sleep 2

# 3. Install backend dependencies
log_info "Installing backend dependencies..."
cd backend
npm install --omit=dev
cd ..

# 4. Build frontend (if exists)
if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then
    log_info "Installing frontend dependencies..."
    cd frontend
    npm install
    
    # ARM64 Rollup fix - CRITICAL for Raspberry Pi
    log_info "Installing ARM64 Rollup binary..."
    npm install @rollup/rollup-linux-arm64-gnu --no-save 2>/dev/null || true
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

# 5. Run database migrations
log_info "Running database migrations..."
cd backend
mkdir -p data
mkdir -p logs
npm run db:migrate || log_warn "Migration may have failed"
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
    log_success "Health check passed!"
else
    log_warn "Health check didn't respond, but service may still be starting"
    pm2 logs forex-backend --lines 20 --nostream
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