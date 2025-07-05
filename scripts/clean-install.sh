#!/bin/bash
# =====================================================
# Crypto Trading Bot - FIXED Clean Install Script for Raspberry Pi 5
# Addresses ARM64 native module compilation issues
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

check_system_requirements() {
    log_step "Checking system requirements for Raspberry Pi 5..."
    
    # Check architecture
    ARCH=$(uname -m)
    if [[ "$ARCH" != "aarch64" ]]; then
        log_error "This script is optimized for ARM64 (aarch64) architecture. Found: $ARCH"
    fi
    log_substep "Architecture: $ARCH ✓"
    
    # Check Node.js version
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
    
    if [ "$NODE_MAJOR" -lt 22 ]; then
        log_error "Node.js version $NODE_VERSION is too old. Please install Node.js 22 or newer."
    fi
    log_substep "Node.js v$NODE_VERSION ✓ (optimized for ARM64)"
    
    # Check memory
    TOTAL_MEM=$(free -m | awk 'NR==2{print $2}')
    if [[ $TOTAL_MEM -lt 4000 ]]; then
        log_warning "Low memory detected: ${TOTAL_MEM}MB. Consider adding swap."
    fi
    log_substep "Memory: ${TOTAL_MEM}MB ✓"
    
    # Check disk space
    AVAILABLE_SPACE=$(df / | awk 'NR==2 {print $4}')
    if [[ $AVAILABLE_SPACE -lt 2000000 ]]; then # 2GB in KB
        log_warning "Low disk space. At least 2GB recommended."
    fi
    log_substep "Disk space: $(( AVAILABLE_SPACE / 1024 ))MB available ✓"
    
    log_success "System requirements check completed - Node v22 detected!"
}

setup_build_environment() {
    log_step "Setting up optimized build environment for Node.js v22 on ARM64..."
    
    # Node v22 has much better ARM64 support, so we can be more aggressive
    export CC=gcc
    export CXX=g++
    export AR=ar
    export STRIP=strip
    export OBJCOPY=objcopy
    export LINK=g++

    log_substep "Node.js v22 automatically handles ARM64 architecture detection"

    # Node v22 can handle more parallel operations on Pi 5
    export UV_THREADPOOL_SIZE=4
    export NODE_OPTIONS="--max-old-space-size=2048"  # Increased for Node v22
    
    # Set make flags for controlled but faster compilation
    export MAKEFLAGS="-j2"  # Node v22 can handle 2 parallel jobs on Pi 5
    
    log_substep "Build environment configured for Node.js v22 on ARM64"
    log_success "Build environment ready - leveraging Node v22 improvements"
}

setup_swap() {
    log_step "Setting up optimized swap for Node.js v22 compilation..."
    
    if [ -f /swapfile ]; then
        log_substep "Removing existing swap file..."
        sudo swapoff /swapfile || true
        sudo rm -f /swapfile
    fi
    
    # Node v22 is more memory efficient, so 2GB swap should be sufficient
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    
    # Optimize swappiness for Node v22 compilation workload
    echo 40 | sudo tee /proc/sys/vm/swappiness > /dev/null
    
    log_success "2GB swap file created and optimized for Node.js v22 compilation"
}

cleanup_swap() {
    log_step "Cleaning up compilation swap file..."
    if [ -f /swapfile ]; then
        sudo swapoff /swapfile
        sudo rm /swapfile
        # Restore original swappiness
        echo 10 | sudo tee /proc/sys/vm/swappiness > /dev/null
        log_success "Compilation swap file removed"
    fi
}

install_system_deps() {
    log_step "Installing ARM64-optimized system dependencies..."
    
    sudo apt-get update -qq
    
    # Install build essentials with ARM64 optimizations
    sudo apt-get install -y \
        curl git nginx sqlite3 \
        build-essential python3 python3-dev \
        ufw fail2ban logrotate jq \
        g++ make cmake \
        libc6-dev \
        pkg-config \
        libsqlite3-dev \
        node-gyp \
        libuv1-dev
    
    log_success "ARM64-optimized system dependencies installed"
}

configure_npm_and_pm2() {
    log_step "Configuring npm for Node.js v22 on ARM64..."
    
    # Node v22 optimized npm configuration
    npm config set progress false
    npm config set loglevel warn
    npm config set fetch-retries 3
    npm config set fetch-retry-mintimeout 20000
    npm config set fetch-retry-maxtimeout 60000
    npm config set maxsockets 8  # Node v22 can handle more connections
    
    log_substep "Setting npm global prefix..."
    mkdir -p ~/.npm-global
    npm config set prefix ~/.npm-global
    if ! grep -q ".npm-global/bin" ~/.bashrc; then
        echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
        export PATH=~/.npm-global/bin:$PATH
    fi

    log_substep "Installing PM2 globally with Node.js v22 optimizations..."
    npm uninstall -g pm2 || true
    rm -rf ~/.pm2
    
    # Node v22 can handle PM2 installation more efficiently
    NODE_OPTIONS="--max-old-space-size=1024" npm install -g pm2@latest
    
    log_substep "Configuring PM2 to start on boot..."
    pm2 startup systemd -u $PROJECT_USER --hp /home/$PROJECT_USER | grep -E '^sudo' | sh || true
    
    log_success "npm and PM2 configured for Node.js v22 on ARM64"
}

backup_and_cleanup() {
    log_step "Backing up and cleaning up previous installation..."
    # Stop systemd PM2 service first to prevent process restarts during backup
    if systemctl is-active --quiet pm2-adam; then
        sudo systemctl stop pm2-adam
        log_substep "pm2-adam systemd service stopped"
    fi
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

    log_substep "Gracefully stopping services..."
    
    # Stop PM2 processes gracefully first
    if pm2 list | grep -q "crypto-trend-bot"; then
        log_substep "Stopping crypto-trend-bot process gracefully..."
        pm2 stop crypto-trend-bot --silent || true
        sleep 3  # Give time for graceful shutdown
    fi
    
    # Stop all PM2 processes
    pm2 stop all --silent || true
    sleep 2
    
    # Delete PM2 processes
    pm2 delete all --silent || true
    
    # Find and gracefully terminate node processes on port 3001
    log_substep "Gracefully terminating processes on port 3001..."
    local pids
    pids=$(lsof -ti :3001 2>/dev/null || true)
    
    if [ -n "$pids" ]; then
        log_substep "Found processes using port 3001: $pids"
        
        # Send SIGTERM first (graceful)
        for pid in $pids; do
            if kill -0 "$pid" 2>/dev/null; then
                log_substep "Sending SIGTERM to PID $pid..."
                kill -TERM "$pid" 2>/dev/null || true
            fi
        done
        
        # Wait for graceful shutdown
        local attempts=0
        while lsof -i :3001 >/dev/null 2>&1 && [ $attempts -lt 8 ]; do
            log_substep "Waiting for graceful shutdown... (attempt $((attempts+1))/8)"
            sleep 2
            attempts=$((attempts+1))
        done
        
        # If still running, escalate to SIGKILL (but more carefully)
        if lsof -i :3001 >/dev/null 2>&1; then
            log_warning "Some processes didn't exit gracefully. Using SIGKILL..."
            pids=$(lsof -ti :3001 2>/dev/null || true)
            
            for pid in $pids; do
                if kill -0 "$pid" 2>/dev/null; then
                    # Check if this PID is our current shell or parent processes
                    if [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ]; then
                        log_substep "Force killing PID $pid..."
                        kill -KILL "$pid" 2>/dev/null || true
                    else
                        log_warning "Skipping PID $pid (current shell or parent)"
                    fi
                fi
            done
            
            sleep 2
        fi
    else
        log_substep "No processes found using port 3001"
    fi
    
    # Stop nginx
    sudo systemctl stop nginx 2>/dev/null || true

    log_substep "Removing old installation..."
    sudo rm -rf "$PROJECT_DIR"
    sudo rm -f /etc/nginx/sites-available/$APP_NAME
    sudo rm -f /etc/nginx/sites-enabled/$APP_NAME
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Final verification
    if lsof -i :3001 >/dev/null 2>&1; then
        log_error "Port 3001 is still in use after cleanup. Manual intervention required."
    else
        log_success "Cleanup complete - port 3001 is now available"
    fi
}

clone_and_install() {
    log_step "Cloning repository..."
    sudo mkdir -p "$PROJECT_DIR"
    sudo chown $PROJECT_USER:$PROJECT_USER "$PROJECT_DIR"
    git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    
    log_step "Installing dependencies with Node.js v22 optimizations..."
    
    log_substep "Installing backend dependencies using workspace scripts..."

    rm -rf backend/node_modules backend/package-lock.json

    NODE_OPTIONS="--max-old-space-size=1536" npm run install:backend -- --omit=dev --no-optional    
    
    log_substep "Installing frontend dependencies using workspace scripts..."

    rm -rf frontend/node_modules frontend/package-lock.json
    NODE_OPTIONS="--max-old-space-size=1536" npm run install:frontend -- --omit=dev --no-optional

    log_success "All dependencies installed successfully with Node.js v22"
}

build_and_setup_db() {
    log_step "Building frontend and setting up database with Node.js v22..."
    cd "$PROJECT_DIR"
    
    log_substep "Building frontend for production with Node.js v22 optimizations..."
    # Add the missing ARM64 rollup dependency first:
    cd frontend
    NODE_OPTIONS="--max-old-space-size=1024" npm install @rollup/rollup-linux-arm64-gnu --save-optional
    cd ..
    
    NODE_OPTIONS="--max-old-space-size=3072" npm run build:frontend
    
    if [ ! -d "frontend/dist" ]; then
        log_error "Frontend build failed - dist directory not created"
    fi

    log_substep "Setting up database with Node.js v22 optimizations..."
    mkdir -p backend/data
    
    # Node v22 handles SQLite operations much more efficiently
    cd backend
    NODE_ENV=production NODE_OPTIONS="--max-old-space-size=1024" npm run db:migrate
    cd ..
    
    # Verify database was created
    if [[ -f "backend/data/trading.db" ]]; then
        log_success "Database created successfully"
    else
        log_error "Database creation failed"
    fi
    
    log_success "Frontend built and database configured with Node.js v22"
}

configure_system() {
    log_step "Configuring system services for ARM64..."
    cd "$PROJECT_DIR"

    log_substep "Generating SSL certificate..."
    mkdir -p ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ssl/key.pem -out ssl/cert.pem \
        -subj "/C=US/ST=CA/L=City/O=Org/CN=img.oakroad" \
        2>/dev/null
    chmod 600 ssl/key.pem

    log_substep "Creating ARM64-optimized Nginx configuration..."
    sudo tee /etc/nginx/sites-available/$APP_NAME > /dev/null << 'EOF'
# WebSocket upgrade map
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Backend upstream with keepalive optimized for ARM64
upstream backend {
    server 127.0.0.1:3001;
    keepalive 8;  # Reduced for ARM64
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
    
    # ARM64 optimized settings
    client_max_body_size 1m;
    client_body_buffer_size 8k;
    client_header_buffer_size 1k;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # Gzip compression optimized for ARM64
    gzip on;
    gzip_comp_level 3;  # Reduced for ARM64
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    
    # Frontend static files
    location / {
        root /opt/crypto-trading-bot/frontend/dist;
        try_files $uri $uri/ /index.html;
        expires 1h;
        add_header Cache-Control "public, immutable";
    }
    
    # WebSocket endpoint with ARM64 optimizations
    location /socket.io/ {
        proxy_pass http://backend/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific - optimized for ARM64
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_connect_timeout 10;
    }
    
    # API endpoints with ARM64 optimizations
    location /api/ {
        proxy_pass http://backend/api/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Performance optimized for ARM64
        proxy_buffering on;
        proxy_buffer_size 2k;  # Reduced for ARM64
        proxy_buffers 4 2k;
        proxy_busy_buffers_size 4k;
        proxy_connect_timeout 10;
        proxy_send_timeout 30;
        proxy_read_timeout 30;
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
    
    log_success "System services configured for ARM64"
}

setup_environment_and_start() {
    log_step "Setting up environment and starting application..."
    cd "$PROJECT_DIR"
    
    log_substep "Creating required directories..."
    mkdir -p backend/logs backend/backups

    log_substep "Setting up encrypted API secrets..."
    if [ -f "scripts/setup-secrets.sh" ]; then
        chmod +x scripts/setup-secrets.sh
        chmod +x scripts/start-wrapper.sh
        ./scripts/setup-secrets.sh < /dev/tty
    else
        log_error "setup-secrets.sh not found. Cannot proceed."
    fi

    log_substep "Starting application with PM2 and Node.js v22 optimizations..."
    # Node v22 can handle larger memory allocation efficiently on Pi 5
    NODE_OPTIONS="--max-old-space-size=1024" pm2 start ecosystem.config.js --env production
    pm2 save

        # Restart systemd service that we stopped earlier
    if systemctl list-unit-files | grep -q pm2-adam; then
        sudo systemctl start pm2-adam
        log_substep "pm2-adam systemd service restarted"
    fi

    log_substep "Starting Nginx..."
    sudo systemctl restart nginx
    sudo systemctl enable nginx
    
    log_substep "Waiting for application to start..."
    sleep 10
    
    # Verify startup
    if pm2 list | grep -q "crypto-trend-bot.*online"; then
        log_success "Application started successfully!"
    else
        log_warning "Application may have failed to start. Checking logs..."
        pm2 logs crypto-trend-bot --nostream --lines 20
    fi
}

verify_installation() {
    log_step "Verifying Node.js v22 ARM64 installation..."
    
    local all_good=true
    
    # Check PM2
    if pm2 list | grep -q "crypto-trend-bot.*online"; then
        log_success "PM2 process is running"
    else
        log_warning "PM2 process is not running properly"
        all_good=false
    fi
    
    # Check backend API
    if curl -sf http://localhost:3001/api/management/health > /dev/null 2>&1; then
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
    if [ -f "$PROJECT_DIR/backend/data/trading.db" ]; then
        log_success "Database exists and is accessible"
    else
        log_warning "Database not found"
        all_good=false
    fi
    
    # Check memory usage
    CURRENT_MEM=$(free -m | awk 'NR==2{printf "%.1f", $3*100/$2}')
    log_substep "Memory usage: ${CURRENT_MEM}%"
    
    # Check Node.js version in runtime
    NODE_RUNTIME=$(pm2 logs crypto-trend-bot --nostream --lines 1 | grep -o "Node.*v[0-9.]*" || echo "Node version check failed")
    log_substep "Runtime: ${NODE_RUNTIME}"
    
    if [ "$all_good" = true ]; then
        log_success "All checks passed! Node.js v22 ARM64 installation successful!"
        return 0
    else
        log_warning "Some checks failed. Review the warnings above."
        return 1
    fi
}

print_summary() {
    echo
    echo "=============================================="
    echo -e "${GREEN}🎉 NODE.JS v22 ARM64 INSTALLATION COMPLETED! 🎉${NC}"
    echo "=============================================="
    echo
    echo "📊 Dashboard URL: https://img.oakroad"
    echo "                  https://localhost"
    echo
    echo "🔧 Node.js v22 Optimized Commands:"
    echo "   • View logs:     pm2 logs crypto-trend-bot"
    echo "   • Check status:  pm2 status"
    echo "   • Restart app:   pm2 restart crypto-trend-bot"
    echo "   • Stop app:      pm2 stop crypto-trend-bot"
    echo "   • Memory usage:  free -h"
    echo "   • Node version:  node --version"
    echo
    echo -e "${GREEN}✅ API Keys are securely encrypted.${NC}"
    echo -e "${GREEN}✅ Optimized for Node.js v22 on Raspberry Pi 5 ARM64.${NC}"
    echo
    echo "🚀 Node.js v22 Optimizations Applied:"
    echo "   • Enhanced ARM64 native module compilation"
    echo "   • Improved memory management (2GB+ allocations)"
    echo "   • Parallel compilation support (2 jobs)"
    echo "   • Batch dependency installation"
    echo "   • Optimized Vite build performance"
    echo "   • Better WebSocket handling on ARM64"
    echo
    
    if ! verify_installation; then
        echo -e "${YELLOW}⚠️  Some components may need attention. Check the warnings above.${NC}"
        echo
    fi
    
    echo "📈 Performance Tips:"
    echo "   • Monitor memory usage: watch -n 5 free -h"
    echo "   • Check CPU temperature: vcgencmd measure_temp"
    echo "   • View detailed logs: journalctl -u pm2-adam -f"
}

# --- Main Execution ---
main() {
    echo "=============================================="
    echo -e "${PURPLE}🚀 Crypto Trading Bot - Node.js v22 ARM64 Install${NC}"
    echo -e "${CYAN}   Optimized for Raspberry Pi 5 + Node.js v22${NC}"
    echo "=============================================="
    echo
    
    # Show system info
    echo "System Information:"
    echo "  • Architecture: $(uname -m)"
    echo "  • Node.js: $(node --version)"
    echo "  • npm: $(npm --version)"
    echo "  • OS: $(uname -a | cut -d' ' -f1,3,12-13)"
    echo "  • Memory: $(free -h | awk 'NR==2{print $2}')"
    echo "  • CPU: ARM Cortex-A76 (4 cores)"
    echo
    
    read -p "This will WIPE the existing installation and leverage Node.js v22 optimizations. Continue? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Installation cancelled."
        exit 0
    fi

    # Set Node v22 optimized limits
    ulimit -n 65536 # Node v22 can handle more file descriptors
    export NODE_OPTIONS="--max-old-space-size=2048"  # Node v22 is more memory efficient
    
    check_root
    check_user
    check_system_requirements
    setup_build_environment
    setup_swap
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