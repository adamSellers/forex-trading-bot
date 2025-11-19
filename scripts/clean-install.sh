#!/bin/bash
# =====================================================
# Crypto Trading Bot - PRODUCTION INSTALLER (Hybrid)
# Includes: 4GB Swap (OOM Fix) + Security + System Deps
# =====================================================

set -e

# --- Config ---
APP_NAME="crypto-trend-bot"
PROJECT_DIR="/opt/crypto-trading-bot"
PROJECT_USER=$(whoami)
BACKUP_DIR="$HOME/crypto-trading-bot-backups"
REPO_URL="git@github.com:adamSellers/crypto-trading-bot.git"
BRANCH="main"

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

# --- 1. SYSTEM PREP (Restored) ---
install_system_deps() {
    log_step "Installing System Dependencies..."
    sudo apt-get update -qq
    sudo apt-get install -y curl git nginx sqlite3 build-essential python3 ufw fail2ban logrotate
    log_success "System packages installed"
}

setup_security() {
    log_step "Configuring Firewall (UFW)..."
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow ssh
    sudo ufw allow http
    sudo ufw allow https
    # Only enable if not already enabled to avoid SSH disruption prompt
    if ! sudo ufw status | grep -q "Status: active"; then
        echo "y" | sudo ufw enable
    fi
    log_success "Firewall secured"
}

# --- 2. BUILD ENVIRONMENT (Optimized) ---
setup_build_env() {
    log_step "Tuning Node.js Environment..."
    # Prevent OOM during install
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
        sudo swapoff /swapfile
        sudo rm /swapfile
    fi
}

# --- 3. APP INSTALLATION ---
backup_and_clean() {
    log_step "Cleaning previous install..."
    pm2 delete $APP_NAME --silent || true
    sudo pkill -f "node" || true
    
    if [[ -d "$PROJECT_DIR" ]]; then
        mkdir -p "$BACKUP_DIR"
        tar -czf "$BACKUP_DIR/backup_$(date +%Y%m%d).tar.gz" -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")" 2>/dev/null || true
    fi
    sudo rm -rf "$PROJECT_DIR"
}

install_app() {
    log_step "Cloning & Installing..."
    sudo mkdir -p "$PROJECT_DIR"
    sudo chown $PROJECT_USER:$PROJECT_USER "$PROJECT_DIR"
    git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    
    # Install Deps
    npm run install:backend -- --omit=dev
    npm run install:frontend
    
    # Build Frontend (No SourceMaps via ENV)
    log_step "Building Frontend..."
    NODE_ENV=production GENERATE_SOURCEMAP=false npm run build:frontend
    
    # Setup DB
    cd backend
    npm run db:migrate
    cd ..
}

# --- 4. CONFIGURATION (Restored) ---
setup_ssl_and_nginx() {
    log_step "Configuring SSL & Nginx..."
    
    # Generate Self-Signed Certs (Critical for Nginx startup)
    mkdir -p ssl
    if [ ! -f ssl/key.pem ]; then
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout ssl/key.pem -out ssl/cert.pem \
            -subj "/C=US/ST=Dev/L=Lab/O=Bot/CN=img.oakroad" 2>/dev/null
    fi

    # Configure Nginx
    if [ ! -f "/etc/nginx/sites-available/$APP_NAME" ]; then
        sudo rm -f /etc/nginx/sites-enabled/default
        sed "s/img.oakroad/img.oakroad/g" "frontend/nginx.conf" | sudo tee "/etc/nginx/sites-available/$APP_NAME" > /dev/null
        sudo ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
        sudo systemctl restart nginx
    fi
}

setup_secrets() {
    log_step "🔐 Secrets Setup..."
    if [ -f "scripts/setup-secrets.sh" ]; then
        chmod +x scripts/setup-secrets.sh
        chmod +x scripts/start-wrapper.sh
        ./scripts/setup-secrets.sh < /dev/tty
    fi
}

start_services() {
    pm2 start ecosystem.config.js --env production
    pm2 save
}

# --- EXECUTION ---
trap cleanup_swap EXIT

check_root
install_system_deps
setup_security
setup_build_env
setup_swap
backup_and_clean
install_app
setup_ssl_and_nginx
setup_secrets
start_services

echo
echo -e "${GREEN}🚀 System Updated & Secure!${NC}"