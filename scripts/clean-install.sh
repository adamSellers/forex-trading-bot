#!/bin/bash
# =====================================================
# Crypto Trading Bot - Clean Install Script for Node.js v22
# Optimized for modern Node.js and npm versions
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

check_node_version() {
    log_step "Checking Node.js version..."
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
    
    if [ "$NODE_MAJOR" -lt 18 ]; then
        log_error "Node.js version $NODE_VERSION is too old. Please install Node.js 18 or newer."
    fi
    
    log_success "Node.js v$NODE_VERSION detected - excellent!"
    log_substep "npm $(npm --version) detected"
}

setup_swap() {
    log_step "Setting up swap file for installation..."
    if [ -f /swapfile ]; then
        log_substep "Removing existing swap file..."
        sudo swapoff /swapfile || true
        sudo rm -f /swapfile
    fi
    
    # 2GB swap for safety
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    log_success "2GB swap file created and enabled."
}

cleanup_swap() {
    log_step "Cleaning up temporary swap file..."
    if [ -f /swapfile ]; then
        sudo swapoff /swapfile
        sudo rm /swapfile
        log_success "Swap file removed."
    fi
}

# --- Installation Steps ---
install_system_deps() {
    log_step "Installing system dependencies..."
    sudo apt-get update -qq
    sudo apt-get install -y \
        curl git nginx sqlite3 \
        build-essential python3 python3-dev \
        ufw fail2ban logrotate jq \
        g++ make cmake
    log_success "System dependencies installed."
}

configure_npm_and_pm2() {
    log_step "Configuring npm and installing PM2..."
    
    # Configure npm for better performance
    log_substep "Optimizing npm configuration..."
    npm config set progress false
    npm config set loglevel warn
    npm config set fetch-retries 3
    npm config set fetch-retry-mintimeout 20000
    npm config set fetch-retry-maxtimeout 60000
    npm config set maxsockets 10
    
    log_substep "Setting npm global prefix..."
    mkdir -p ~/.npm-global
    npm config set prefix ~/.npm-global
    if ! grep -q ".npm-global/bin" ~/.bashrc; then
        echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
        export PATH=~/.npm-global/bin:$PATH
    fi

    log_substep "Installing PM2 globally..."
    npm uninstall -g pm2 || true
    rm -rf ~/.pm2
    npm install -g pm2@latest
    
    log_substep "Configuring PM2 to start on boot..."
    pm2 startup systemd -u $PROJECT_USER --hp /home/$PROJECT_USER | grep -E '^sudo' | sh || true
    log_success "npm and PM2 configured successfully."
}

backup_and_cleanup() {
    log_step "Backing up and cleaning up previous installation..."
    if [[ -d "$PROJECT_DIR" ]]; then
        log_substep "Creating backup..."
        sudo mkdir -p "$BACKUP_DIR"
        timestamp=$(date +%Y%m%d_%H%M%S)
        sudo tar -czf "$BACKUP_DIR/backup_$timestamp.tar.gz" \
            --exclude='node_modules' \
            --exclude='frontend/node_modules' \
            --exclude='backend/node_modules' \
            -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")"
        log_success "Backup created at $BACKUP_DIR/backup_$timestamp.tar.gz"
    fi

    log_substep "Stopping services..."
    pm2 stop all || true
    pm2 delete all || true
    sudo systemctl stop nginx || true

    log_substep "Removing old installation..."
    sudo rm -rf "$PROJECT_DIR"
    sudo rm -f /etc/nginx/sites-available/$APP_NAME
    sudo rm -f /etc/nginx/sites-enabled/$APP_NAME
    sudo rm -f /etc/nginx/sites-enabled/default
    log_success "Cleanup complete."
}

clone_and_install() {
    log_step "Cloning repository..."
    sudo mkdir -p "$PROJECT_DIR"
    sudo chown $PROJECT_USER:$PROJECT_USER "$PROJECT_DIR"
    git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    
    log_step "Installing dependencies (Node.js v22 optimized)..."
    
    log_substep "Installing workspace root dependencies..."
    rm -rf node_modules package-lock.json
    npm install
    
    log_substep "Installing backend dependencies..."
    # We run from the root to maintain workspace context, but modify the backend's package.json first.
    if command -v jq &> /dev/null; then
        log_substep "Updating backend/package.json for optional dependencies..."
        cp backend/package.json backend/package.json.bak
        jq '.optionalDependencies = {"bufferutil": "^4.0.8", "utf-8-validate": "^6.0.3"}' backend/package.json.bak > backend/package.json
    fi
    
    # Install backend dependencies from the root, for production. The '--' passes the flag to the underlying npm command.
    NODE_ENV=production npm run install:backend -- --omit=dev

    # Try to install optional native modules separately, again from the root.
    log_substep "Attempting native module installation for backend..."
    npm install bufferutil@^4.0.8 --save-optional --prefix backend || log_warning "bufferutil skipped (non-critical)"
    npm install utf-8-validate@^6.0.3 --save-optional --prefix backend || log_warning "utf-8-validate skipped (non-critical)"

    log_substep "Installing frontend dependencies..."
    # Use the script from package.json, which runs from the root. This ensures devDependencies are installed for the build.
    npm run install:frontend
    
    log_success "All dependencies installed successfully."
}

build_and_setup_db() {
    log_step "Building frontend and setting up database..."
    cd "$PROJECT_DIR"
    
    log_substep "Building frontend for production..."
    npm run build:frontend
    if [ ! -d "frontend/dist" ]; then
        log_error "Frontend build failed - dist directory not created"
    fi

    log_substep "Setting up database..."
    mkdir -p backend/data
    
    # Ensure correct database path
    if [ -f "backend/knexfile.js" ]; then
        log_substep "Verifying database configuration..."
        # Update both development and production configs to use trading.db
        sed -i 's/trading_bot\.db/trading.db/g' backend/knexfile.js || true  # Ensure consistent name
    fi
    
    npm run db:migrate
    
    # Verify database was created
    if [[ -f "backend/data/trading.db" ]]; then  # Check for the consistent name
        log_success "Database created successfully"
    else
        log_error "Database creation failed"
    fi
    log_success "Frontend built and database configured."
}

configure_system() {
    log_step "Configuring system services..."
    cd "$PROJECT_DIR"

    log_substep "Generating SSL certificate..."
    mkdir -p ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ssl/key.pem -out ssl/cert.pem \
        -subj "/C=US/ST=CA/L=City/O=Org/CN=img.oakroad" \
        2>/dev/null
    chmod 600 ssl/key.pem

    log_substep "Creating optimized Nginx configuration..."
    sudo tee /etc/nginx/sites-available/$APP_NAME > /dev/null << 'EOF'
# WebSocket upgrade map
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Backend upstream with keepalive
upstream backend {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 80;
    listen 443 ssl http2;
    server_name localhost img img.oakroad;
    
    # SSL configuration
    ssl_certificate /opt/crypto-trading-bot/ssl/cert.pem;
    ssl_certificate_key /opt/crypto-trading-bot/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    
    # Frontend static files
    location / {
        root /opt/crypto-trading-bot/frontend/dist;
        try_files $uri $uri/ /index.html;
        expires 1h;
        add_header Cache-Control "public, immutable";
    }
    
    # WebSocket endpoint
    location /socket.io/ {
        proxy_pass http://backend/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
    }
    
    # API endpoints
    location /api/ {
        proxy_pass http://backend/api/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Performance
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;
    }
}
EOF

    sudo ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    
    log_substep "Testing Nginx configuration..."
    sudo nginx -t

    log_substep "Configuring firewall..."
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
    
    log_substep "Creating required directories..."
    mkdir -p backend/logs backend/backups

    # Securely set up API keys by calling the encryption script
    log_substep "Setting up encrypted API secrets..."
    if [ -f "scripts/setup-secrets.sh" ]; then
        # Make scripts executable
        chmod +x scripts/setup-secrets.sh
        chmod +x scripts/start-wrapper.sh
        ./scripts/setup-secrets.sh
    else
        log_error "setup-secrets.sh not found. Cannot proceed."
    fi
    
    log_substep "Starting application with PM2..."
    pm2 start ecosystem.config.js --env production
    pm2 save

    log_substep "Starting Nginx..."
    sudo systemctl restart nginx
    sudo systemctl enable nginx
    
    # Wait for app to start
    log_substep "Waiting for application to start..."
    sleep 8
    
    # Verify startup
    if pm2 list | grep -q "crypto-trend-bot.*online"; then
        log_success "Application started successfully!"
    else
        log_warning "Application may have failed to start. Checking logs..."
        pm2 logs crypto-trend-bot --nostream --lines 20
    fi
}

verify_installation() {
    log_step "Verifying installation..."
    
    local all_good=true
    
    # Check PM2
    if pm2 list | grep -q "crypto-trend-bot.*online"; then
        log_success "PM2 process is running"
    else
        log_warning "PM2 process is not running properly"
        all_good=false
    fi
    
    # Check backend API
    if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
        log_success "Backend API is responding"
    else
        log_warning "Backend API is not responding"
        all_good=false
    fi
    
    # Check Nginx
    if sudo systemctl is-active --quiet nginx; then
        log_success "Nginx is running"
    else
        log_warning "Nginx is not running"
        all_good=false
    fi
    
    # Check frontend
    if [ -d "$PROJECT_DIR/frontend/dist" ]; then
        log_success "Frontend build exists"
    else
        log_warning "Frontend build missing"
        all_good=false
    fi
    
    # Check database
    if [ -f "$PROJECT_DIR/backend/data/trading.db" ] || [ -f "$PROJECT_DIR/backend/data/trading_bot.db" ]; then
        log_success "Database exists"
    else
        log_warning "Database not found"
        all_good=false
    fi
    
    if [ "$all_good" = true ]; then
        log_success "All checks passed!"
        return 0
    else
        log_warning "Some checks failed. Review the warnings above."
        return 1
    fi
}

print_summary() {
    echo
    echo "=============================================="
    echo -e "${GREEN}🎉 INSTALLATION COMPLETED! 🎉${NC}"
    echo "=============================================="
    echo
    echo "📊 Dashboard URL: https://img.oakroad"
    echo "                  https://localhost"
    echo
    echo "🔧 Quick Commands:"
    echo "   • View logs:     pm2 logs crypto-trend-bot"
    echo "   • Check status:  pm2 status"
    echo "   • Restart app:   pm2 restart crypto-trend-bot"
    echo "   • Stop app:      pm2 stop crypto-trend-bot"
    echo
    echo -e "${GREEN}✅ API Keys are securely encrypted.${NC}"
    echo
    echo "To update your API keys in the future, run this command on the server:"
    echo "   cd $PROJECT_DIR && ./scripts/setup-secrets.sh"
    echo
    echo "Then restart the application:"
    echo "   pm2 restart crypto-trend-bot"
    echo
    
    if ! verify_installation; then
        echo -e "${YELLOW}⚠️  Some components may need attention. Check the warnings above.${NC}"
        echo
    fi
}

# --- Main Execution ---
main() {
    echo "=============================================="
    echo -e "${PURPLE}🚀 Crypto Trading Bot - Clean Install${NC}"
    echo -e "${CYAN}   Optimized for Node.js v22${NC}"
    echo "=============================================="
    echo
    
    # Show system info
    echo "System Information:"
    echo "  • Node.js: $(node --version)"
    echo "  • npm: $(npm --version)"
    echo "  • OS: $(uname -a | cut -d' ' -f1,3,12)"
    echo
    
    read -p "This will WIPE the existing installation. Continue? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Installation cancelled."
        exit 0
    fi

    # Set higher limits for Node 22
    ulimit -n 8192
    export NODE_OPTIONS="--max-old-space-size=1024"
    
    setup_swap
    check_root
    check_user
    check_node_version
    install_system_deps
    configure_npm_and_pm2
    backup_and_cleanup
    clone_and_install
    build_and_setup_db
    configure_system
    setup_environment_and_start
    cleanup_swap
    print_summary
}

# Trap errors for debugging
trap 'log_error "Script failed at line $LINENO. Exit code: $?"' ERR

# Run main function
main "$@"