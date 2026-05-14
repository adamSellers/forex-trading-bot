#!/bin/bash
# =====================================================
# Forex Trading Bot - PRODUCTION INSTALLER (Hybrid)
# Includes: 4GB Swap (OOM Fix) + Security + System Deps
# Production installer for forex-trading-bot
# =====================================================

set -e

# --- Config ---
APP_NAME="forex-backend"
PROJECT_DIR="/opt/forex-trading-bot"
PROJECT_USER=$(whoami)
BACKUP_DIR="$HOME/forex-backups"
REPO_URL="git@github.com:adamSellers/forex-trading-bot.git"
BRANCH="main"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"

# --- Styling ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log_step() { echo -e "${BLUE}🔧 $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "Run as user '$PROJECT_USER', NOT root."
    fi
}

# --- 1. SYSTEM PREP ---
install_system_deps() {
    log_step "Installing System Dependencies..."
    sudo apt-get update -qq
    sudo apt-get install -y curl git sqlite3 build-essential python3
    log_success "System packages installed"
}

# --- 2. BUILD ENVIRONMENT (OOM Prevention) ---
setup_build_env() {
    log_step "Tuning Node.js Environment..."
    # Limit parallelism to prevent OOM
    export UV_THREADPOOL_SIZE=2
    export MAKEFLAGS="-j2"
    export NODE_OPTIONS="--max-old-space-size=3584"

    # Ensure PM2 is installed globally
    if ! command -v pm2 &> /dev/null; then
        sudo npm install -g pm2
    fi
}

setup_swap() {
    log_step "Setting up 4GB Build Swap..."
    if [ -f /swapfile ]; then
        sudo swapoff /swapfile || true
        sudo rm -f /swapfile
    fi
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    log_success "Swap active"
}

cleanup_swap() {
    if [ -f /swapfile ]; then
        sudo swapoff /swapfile || true
        sudo rm -f /swapfile || true
    fi
}

# --- 3. APP INSTALLATION ---
backup_and_clean() {
    log_step "Cleaning previous forex install..."
    # Only delete forex services
    pm2 delete $APP_NAME --silent 2>/dev/null || true

    if [[ -d "$PROJECT_DIR" ]]; then
        mkdir -p "$BACKUP_DIR"
        # Backup database if exists
        if [ -f "$PROJECT_DIR/backend/data/trading.db" ]; then
            cp "$PROJECT_DIR/backend/data/trading.db" "$BACKUP_DIR/trading_$(date +%Y%m%d_%H%M%S).db" || true
        fi
    fi
    sudo rm -rf "$PROJECT_DIR"
}

install_app() {
    log_step "Cloning & Installing..."
    sudo mkdir -p "$PROJECT_DIR"
    sudo chown $PROJECT_USER:$PROJECT_USER "$PROJECT_DIR"
    git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"

    # Install Backend Deps (production only)
    log_step "Installing backend dependencies..."
    npm run install:backend -- --omit=dev

    # SKIP FRONTEND ON PI - build locally and scp dist/ folder
    log_warn "Skipping frontend build on Pi (causes OOM)"
    log_warn "Build locally: cd frontend && npm run build"
    log_warn "Then scp: scp -r dist/ adam@img.oakroad:/opt/forex-trading-bot/frontend/"
    mkdir -p frontend/dist

    # Setup DB
    log_step "Running database migrations..."
    cd backend
    npm run db:migrate
    cd ..

    log_success "Backend installed (frontend: build locally & scp)"
}

# --- 4. CONFIGURATION ---
setup_secrets() {
    log_step "Secrets Setup..."
    if [ -f "scripts/setup-secrets.sh" ]; then
        chmod +x scripts/setup-secrets.sh
        chmod +x scripts/start-wrapper.sh
        ./scripts/setup-secrets.sh < /dev/tty
    fi
}

start_services() {
    log_step "Starting services with PM2..."
    pm2 start ecosystem.config.js --env production
    pm2 save
    log_success "Services started"
}

# --- EXECUTION ---
trap cleanup_swap EXIT

echo
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}       FOREX TRADING BOT - CLEAN INSTALL${NC}"
echo -e "${GREEN}       (Raspberry Pi Optimized)${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo

check_root
install_system_deps
setup_build_env
setup_swap
backup_and_clean
install_app
setup_secrets
start_services

echo
echo -e "${GREEN}🚀 Forex Trading Bot Installed Successfully!${NC}"
echo -e "   Dashboard: http://img.oakroad:3100"
echo -e "   API:       http://img.oakroad:3101/api"
echo
