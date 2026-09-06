#!/bin/bash
# =====================================================
# Forex Trading Bot - First Time Setup (Raspberry Pi)
# Includes: 4GB Swap (OOM Fix) + Pi Build Optimizations
# Run this ONCE to set up the forex bot
# =====================================================

set -e

# --- Config ---
APP_NAME="forex-backend"
PROJECT_DIR="/opt/forex-trading-bot"
PROJECT_USER=$(whoami)
REPO_URL="git@github.com:adamSellers/forex-trading-bot.git"
BRANCH="main"

# --- Colors ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log_step() { echo -e "${BLUE}🔧 $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"
source "$SCRIPT_DIR/load-operator-auth.sh"

# --- Pi-Specific: Swap Management ---
setup_swap() {
    log_step "Setting up 8GB Build Swap (OOM prevention)..."
    if [ -f /swapfile ]; then
        sudo swapoff /swapfile || true
        sudo rm -f /swapfile
    fi
    sudo fallocate -l 8G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    log_success "Swap active (8GB)"
}

cleanup_swap() {
    log_step "Cleaning up build swap..."
    if [ -f /swapfile ]; then
        sudo swapoff /swapfile 2>/dev/null || true
        sudo rm -f /swapfile
    fi
}

# --- Pi-Specific: Build Environment ---
setup_build_env() {
    log_step "Tuning Node.js for Raspberry Pi build..."
    export UV_THREADPOOL_SIZE=2
    export MAKEFLAGS="-j2"
    export NODE_OPTIONS="--max-old-space-size=3584"
    log_success "Build environment configured"
}

# Ensure swap is cleaned up on exit (success or failure)
trap cleanup_swap EXIT

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "       🚀 FOREX TRADING BOT - FIRST TIME SETUP"
echo "           (Raspberry Pi Optimized)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# --- Validation ---
if [[ $EUID -eq 0 ]]; then
    log_error "Don't run as root. Use your normal user (adam)."
fi

if [ -d "$PROJECT_DIR" ]; then
    log_warn "Directory $PROJECT_DIR already exists!"
    read -p "Remove and start fresh? (y/N): " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        pm2 delete $APP_NAME --silent 2>/dev/null || true
        sudo rm -rf "$PROJECT_DIR"
    else
        log_error "Aborting. Use deploy.sh for updates instead."
    fi
fi

# --- 1. Setup Build Environment ---
setup_build_env
setup_swap

# --- 2. Clone Repository ---
log_step "Cloning forex-trading-bot repository..."
sudo mkdir -p "$PROJECT_DIR"
sudo chown $PROJECT_USER:$PROJECT_USER "$PROJECT_DIR"
git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
cd "$PROJECT_DIR"
log_success "Repository cloned"

# --- 3. Install Dependencies + Verify ---
log_step "Installing backend dependencies from lockfile..."
cd backend
npm ci
log_step "Running backend test suite..."
npm test -- --runInBand
cd ..

if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then
    log_step "Installing frontend dependencies from lockfile..."
    cd frontend
    npm ci
    cd ..
fi
log_success "Dependencies installed"

# --- 4. Build Frontend ---
if [ -d "frontend" ]; then
    log_step "Building frontend (this may take a few minutes on Pi)..."
    cd frontend
    # Memory constrained build with no source maps
    NODE_OPTIONS="--max-old-space-size=2048" NODE_ENV=production GENERATE_SOURCEMAP=false npm run build
    cd ..
    
    if [ -d "frontend/dist" ]; then
        log_success "Frontend built successfully"
    else
        log_warn "Frontend build may have issues - check logs"
    fi
fi

# --- 5. Setup Database ---
log_step "Setting up database..."
cd backend
mkdir -p data
mkdir -p logs
npm run db:migrate
npm prune --omit=dev
cd ..
log_success "Database initialized"

# --- 6. Setup Secrets ---
log_step "Setting up encrypted secrets..."
chmod +x scripts/*.sh
./scripts/setup-secrets.sh < /dev/tty
./scripts/setup-operator-access.sh

# --- 7. Register with PM2 ---
log_step "Registering with PM2..."
pm2 start ecosystem.config.js --env production
pm2 save
log_success "PM2 configured"

# --- 8. Health Check ---
log_step "Running health check..."
sleep 5
max_attempts=12
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if forex_api_curl -f -s http://localhost:3101/api/health > /dev/null 2>&1; then
        break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 5
done
echo ""

if [ $attempt -lt $max_attempts ]; then
    log_success "Health check passed!"
    
    # Show status
    echo ""
    forex_api_curl -s http://localhost:3101/api/health | python3 -m json.tool 2>/dev/null || forex_api_curl -s http://localhost:3101/api/health
else
    log_warn "Health check timed out - checking logs..."
    pm2 logs forex-backend --lines 30 --nostream
fi

# --- Done! ---
echo ""
echo "═══════════════════════════════════════════════════════════"
log_success "🎉 FOREX BOT SETUP COMPLETE!"
echo ""
echo "Services:"
echo "  Backend:  http://localhost:3101"
echo "  Frontend: http://fx.oakroad"
echo ""
echo "Quick Commands:"
echo "  pm2 status                    - Check both bots"
echo "  pm2 logs forex-backend        - View forex logs"
echo "  pm2 restart forex-backend     - Restart forex bot"
echo ""
echo "Next Steps:"
echo "  1. Open http://fx.oakroad and verify connection"
echo "  2. Check Settings → all config loaded correctly"
echo "  3. Trading is DISABLED by default - enable when ready"
echo "═══════════════════════════════════════════════════════════"
