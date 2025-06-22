#!/bin/bash
# =====================================================
# Crypto Trading Bot - Consolidated Clean Install Script
# This script completely removes the existing installation
# and performs a fresh install from the git repository.
# =====================================================

set -e  # Exit on any error

# --- Configuration ---
APP_NAME="crypto-trend-bot"
PROJECT_DIR="/opt/crypto-trading-bot"
PROJECT_USER="adam"
BACKUP_DIR="/opt/crypto-trading-bot-backups"
REPO_URL="git@github.com:adamSellers/crypto-trading-bot.git"
BRANCH="main"

# --- Colors for output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# --- Logging functions ---
log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; exit 1; }
log_step() { echo -e "${PURPLE}🔧 $1${NC}"; }
log_substep() { echo -e "${CYAN}   └─ $1${NC}"; }

# --- Helper Functions ---
check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "This script should not be run as root. Run as user '$PROJECT_USER' with sudo access."
    fi
}

check_user() {
    if [[ "$(whoami)" != "$PROJECT_USER" ]]; then
        log_error "Script must be run as user '$PROJECT_USER'. Current user: $(whoami)"
    fi
    log_success "Running as correct user: $PROJECT_USER"
}

# --- Installation Steps ---
install_system_deps() {
    log_step "Installing system dependencies..."
    sudo apt-get update -qq
    sudo apt-get install -y curl git nginx sqlite3 build-essential python3 ufw fail2ban logrotate jq
    log_success "System dependencies installed."
}

configure_npm_and_pm2() {
    log_step "Configuring Node.js environment and PM2..."
    if ! command -v node &> /dev/null; then log_error "Node.js is not installed."; fi
    log_substep "Node.js $(node --version) and npm $(npm --version) detected."

    log_substep "Setting npm global prefix to ~/.npm-global"
    npm config set prefix ~/.npm-global
    if ! grep -q ".npm-global/bin" ~/.bashrc; then
        echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
        export PATH=~/.npm-global/bin:$PATH
    fi

    log_substep "Installing/updating PM2..."
    npm install -g pm2
    log_substep "Configuring PM2 to start on boot..."
    pm2 startup systemd -u $PROJECT_USER --hp /home/$PROJECT_USER | grep -E '^sudo' | sh || true
    log_success "Node.js environment and PM2 configured."
}

backup_and_cleanup() {
    log_step "Backing up and cleaning up previous installation..."
    if [[ -d "$PROJECT_DIR" ]]; then
        log_substep "Creating backup of existing installation..."
        sudo mkdir -p "$BACKUP_DIR"
        timestamp=$(date +%Y%m%d_%H%M%S)
        sudo tar -czf "$BACKUP_DIR/backup_$timestamp.tar.gz" -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")"
        log_success "Backup created at $BACKUP_DIR/backup_$timestamp.tar.gz"
    else
        log_info "No existing installation found, skipping backup."
    fi

    log_substep "Stopping services..."
    pm2 stop all || true
    pm2 delete all || true
    sudo systemctl stop nginx || true

    log_substep "Removing old project directory and Nginx config..."
    sudo rm -rf "$PROJECT_DIR"
    sudo rm -f /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/$APP_NAME
    log_success "Cleanup complete."
}

clone_and_install() {
    log_step "Cloning repository and installing dependencies..."
    sudo mkdir -p "$PROJECT_DIR"
    sudo chown $PROJECT_USER:$PROJECT_USER "$PROJECT_DIR"
    git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    log_substep "Installing all npm dependencies..."
    npm install
    log_success "Repository cloned and dependencies installed."
}

build_and_setup_db() {
    log_step "Building frontend and setting up database..."
    cd "$PROJECT_DIR"
    log_substep "Building frontend for production..."
    npm run build:frontend

    log_substep "Creating data directory..."
    mkdir -p backend/data
    log_substep "Running database migrations..."
    cd backend
    NODE_ENV=production npx knex migrate:latest
    cd ..
    if [[ ! -f "backend/data/trading_bot.db" ]]; then
        log_error "Database migration failed. 'trading_bot.db' not found."
    fi
    log_success "Frontend built and database migrated."
}

configure_system() {
    log_step "Configuring system services (Nginx, SSL, Firewall)..."
    cd "$PROJECT_DIR"

    log_substep "Generating self-signed SSL certificate..."
    mkdir -p ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ssl/key.pem -out ssl/cert.pem \
        -subj "/C=US/ST=CA/L=City/O=Org/CN=img.oakroad"
    chmod 600 ssl/key.pem

    log_substep "Creating Nginx configuration..."
    sudo tee /etc/nginx/sites-available/$APP_NAME > /dev/null << EOF
# This map block is essential for correctly handling the WebSocket upgrade protocol.
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}
upstream backend { server 127.0.0.1:3001; keepalive: 32; }
server {
    listen 80;
    listen 443 ssl http2;
    server_name localhost img img.oakroad;
    ssl_certificate $PROJECT_DIR/ssl/cert.pem;
    ssl_certificate_key $PROJECT_DIR/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    location / {
        root $PROJECT_DIR/frontend/dist;
        try_files \$uri \$uri/ /index.html;
    }
    location /socket.io/ {
        proxy_pass http://backend/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
    }
    location /api/ {
        proxy_pass http://backend/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
    }
}
EOF
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
    sudo nginx -t

    log_substep "Configuring firewall (UFW)..."
    sudo ufw --force reset
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow ssh
    sudo ufw allow http
    sudo ufw allow https
    sudo ufw --force enable
    log_success "System services configured."
}

setup_environment_and_start() {
    log_step "Setting up environment and starting application..."
    cd "$PROJECT_DIR"
    if [[ ! -f "backend/.env" ]]; then
        log_substep "Creating backend .env file..."
        cat > backend/.env << EOF
NODE_ENV=production
PORT=3001
DB_PATH=$PROJECT_DIR/backend/data/trading_bot.db
DB_BACKUP_PATH=$PROJECT_DIR/backend/backups
LOG_LEVEL=info
LOG_PATH=$PROJECT_DIR/backend/logs
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here
USE_REAL_BINANCE_DATA=true
CORS_ORIGIN=https://localhost,https://img.oakroad
EOF
    fi
    mkdir -p backend/logs backend/backups

    log_substep "Starting application with PM2..."
    # Use the main ecosystem.config.js from the repo
    pm2 start ecosystem.config.js --env production
    pm2 save

    log_substep "Starting Nginx..."
    sudo systemctl restart nginx
    log_success "Application started."
}

health_check() {
    log_step "Running final health checks..."
    sleep 5 # Give services time to start
    if ! pm2 list | grep -q "$APP_NAME.*online"; then log_error "PM2 process is not online."; fi
    log_success "PM2 process is online."
    if ! curl -f -s -k https://localhost/api/management/health > /dev/null; then log_error "API health check failed."; fi
    log_success "API health check passed."
}

print_summary() {
    echo
    echo "=============================================="
    echo -e "${GREEN}🎉 INSTALLATION COMPLETED! 🎉${NC}"
    echo "=============================================="
    echo
    echo "📊 Dashboard URL: https://img.oakroad (or https://localhost)"
    echo
    echo "🔧 Management Commands (run from your dev machine):"
    echo "   • Deploy updates: ./scripts/deploy.sh"
    echo "   • View logs:      ./scripts/logs.sh"
    echo "   • Check status:   ./scripts/status.sh"
    echo
    echo "⚠️  CRITICAL NEXT STEP:"
    echo "   1. SSH into the Pi: ssh $PROJECT_USER@img.oakroad"
    echo "   2. Edit the .env file: nano $PROJECT_DIR/backend/.env"
    echo "   3. Add your real Binance API keys."
    echo "   4. Restart the app: pm2 restart $APP_NAME"
    echo
}

# --- Main Execution ---
main() {
    echo "=============================================="
    echo -e "${PURPLE}🚀 Crypto Trading Bot - Clean Install${NC}"
    echo "=============================================="
    read -p "This will WIPE the existing installation. Continue? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Installation cancelled."
        exit 0
    fi

    check_root
    check_user
    install_system_deps
    configure_npm_and_pm2
    backup_and_cleanup
    clone_and_install
    build_and_setup_db
    configure_system
    setup_environment_and_start
    health_check
    print_summary
}

main "$@"
