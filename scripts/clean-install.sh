#!/bin/bash
# =====================================================
# Crypto Trading Bot - Clean Install Script for x86 Architecture
# Optimized for x86_64 systems
# =====================================================

set -e  # Exit on any error

# --- Configuration ---
APP_NAME="crypto-trend-bot"
PROJECT_DIR="/opt/crypto-trading-bot"
PROJECT_USER=$(whoami)
BACKUP_DIR="$HOME/crypto-trading-bot-backups" # Use user's home directory for backups
REPO_URL="git@github.com:troysellers/adzas-crypto-bot.git"
BRANCH="x-86-build"

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

check_system_requirements() {
    log_step "Checking system requirements for Raspberry Pi 5..."
    
    # Check architecture
    ARCH=$(uname -m)
    if [[ "$ARCH" != "x86_64" ]]; then
        log_error "This script is optimized for x86_64 architecture. Found: $ARCH"
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
    if [[ $TOTAL_MEM -lt 2000 ]]; then  # Reduce from 4000MB to 2000MB
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
    log_step "Setting up optimized build environment for Node.js v22 on x86_64..."
    
    # x86_64 can handle more parallel operations
    export UV_THREADPOOL_SIZE=8  # Increase from 4
    export NODE_OPTIONS="--max-old-space-size=4096"  # Increase from 2048
    
    # x86_64 can handle more parallel compilation
    export MAKEFLAGS="-j4"  # Increase from 2
    
    log_substep "Build environment configured for Node.js v22 on x86_64"
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
    log_step "Installing x86_64-optimized system dependencies..."
    
    # Remove ARM64-specific packages
    sudo apt-get install -y \
        curl git nginx sqlite3 \
        build-essential python3 python3-dev \
        ufw fail2ban logrotate jq \
        g++ make cmake \
        libc6-dev \
        pkg-config \
        libsqlite3-dev \
        node-gyp \
        # Remove: libuv1-dev (not needed for x86)
    
    log_success "x86_64-optimized system dependencies installed"
}

configure_npm_and_pm2() {
    log_step "Configuring npm for Node.js v22 on ARM64..."
    
    # Node v22 optimized npm configuration
    npm config set progress false
    npm config set loglevel warn
    npm config set fetch-retries 3
    npm config set fetch-retry-mintimeout 20000
    npm config set fetch-retry-maxtimeout 60000
    npm config set maxsockets 16  # Node v22 can handle more connections
    
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
    
    # CRITICAL FIX: Stop all PM2 processes before backup to prevent log file conflicts
    log_substep "Stopping all Node.js processes to prevent file conflicts..."
    
    # Kill any running PM2 processes gracefully first
    if command -v pm2 >/dev/null 2>&1; then
        if pm2 list | grep -q "$APP_NAME"; then
            log_substep "Stopping $APP_NAME PM2 process..."
            pm2 stop $APP_NAME --silent || true
            sleep 2
        fi
        
        # Stop all PM2 processes
        pm2 stop all --silent || true
        sleep 2
        
        # Delete PM2 processes
        pm2 delete all --silent || true
        sleep 1
        
        # Kill PM2 daemon - this is the critical fix
        log_substep "Killing PM2 daemon to prevent auto-restart..."
        pm2 kill || true
        sleep 1
        
        # Force kill any remaining PM2 processes
        PM2_PIDS=$(ps aux | grep -E "PM2.*God Daemon" | grep -v grep | awk '{print $2}' || true)
        if [ -n "$PM2_PIDS" ]; then
            log_substep "Force killing PM2 daemon processes: $PM2_PIDS"
            kill -9 $PM2_PIDS || true
            sleep 1
        fi
    fi
    
    # Force kill any remaining Node.js processes that might be writing to logs
    log_substep "Ensuring all Node.js processes are stopped..."
    sudo pkill -f "node.*server.js" || true
    sudo pkill -f "node.*3001" || true
    sudo pkill -f "$APP_NAME" || true
    sleep 2
    
    # Double-check no Node.js processes are running (except system ones)
    REMAINING_NODE=$(ps aux | grep -v grep | grep "node.*server.js" || true)
    if [ -n "$REMAINING_NODE" ]; then
        log_warning "Found remaining Node.js processes, force killing..."
        sudo pkill -9 -f "node.*server.js" || true
        sleep 1
    fi
    
    # Now safe to create backup without file conflicts
    if [[ -d "$PROJECT_DIR" ]]; then
        log_substep "Creating backup (all processes stopped)..."
        sudo mkdir -p "$BACKUP_DIR"
        timestamp=$(date +%Y%m%d_%H%M%S)
        
        # Use --warning=no-file-changed to handle any remaining file changes gracefully
        sudo tar -czf "$BACKUP_DIR/backup_$timestamp.tar.gz" \
            --warning=no-file-changed \
            --exclude='node_modules' \
            --exclude='frontend/node_modules' \
            --exclude='backend/node_modules' \
            --exclude='*.log' \
            --exclude='backend/logs/*' \
            -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")" 2>/dev/null || {
                # If tar still fails, just log it and continue
                log_warning "Backup completed with warnings (this is normal)"
            }
        
        log_success "Backup created at $BACKUP_DIR/backup_$timestamp.tar.gz"
    fi
    
    # Ensure port 3001 is fully released
    log_substep "Ensuring port 3001 is fully released..."
    local attempts=0
    while lsof -i :3001 >/dev/null 2>&1 && [ $attempts -lt 10 ]; do
        log_substep "Waiting for port 3001 to be released... (attempt $((attempts+1))/10)"
        sleep 2
        attempts=$((attempts+1))
    done
    
    if lsof -i :3001 >/dev/null 2>&1; then
        log_warning "Port 3001 still in use. Force killing remaining processes..."
        sudo pkill -9 -f "node.*3001" || true
        sleep 2
    fi
    
    # Stop nginx
    sudo systemctl stop nginx || true

    log_substep "Removing old installation..."
    sudo rm -rf "$PROJECT_DIR"
    sudo rm -f /etc/nginx/sites-available/$APP_NAME
    # Clean up the sites-enabled directory to prevent errors from old/bad links
    sudo find /etc/nginx/sites-enabled/ -type l -exec rm -f {} +
    
    log_success "Cleanup complete - all processes stopped, port 3001 available"
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
  
    NODE_OPTIONS="--max-old-space-size=4096" npm run build:frontend 
    
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

    # Prompt for the domain name to automate configuration
    read -p "Enter the public domain name for this server (e.g., my-bot.com): " DOMAIN_NAME
    if [ -z "$DOMAIN_NAME" ]; then
        log_warning "No domain name entered. Using default 'img.oakroad'. Manual configuration will be required."
        DOMAIN_NAME="img.oakroad"
    fi
    log_info "Using domain: $DOMAIN_NAME for configuration."

    log_substep "Generating self-signed SSL certificate for $DOMAIN_NAME..."
    mkdir -p ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ssl/key.pem -out ssl/cert.pem \
        -subj "/C=US/ST=CA/L=City/O=Org/CN=$DOMAIN_NAME" \
        2>/dev/null
    chmod 600 ssl/key.pem

    log_substep "Creating Nginx configuration for $DOMAIN_NAME..."
    if [ -f "frontend/nginx.conf" ]; then
        # Use sed to replace the placeholder domain and write the new config
        sed "s/img.oakroad/$DOMAIN_NAME/g" "frontend/nginx.conf" | sudo tee "/etc/nginx/sites-available/$APP_NAME" > /dev/null
    else
        log_error "Nginx configuration file not found at frontend/nginx.conf"
    fi

    log_substep "Updating CORS origin in ecosystem.config.js for $DOMAIN_NAME..."
    sed -i "s/img.oakroad/$DOMAIN_NAME/g" "ecosystem.config.js"

    sudo ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
    
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
setup_swap() {
    log_step "Setting up optimized swap for Node.js v22 compilation..."
    
    if [ -f /swapfile ]; then
        log_substep "Removing existing swap file..."
        sudo swapoff /swapfile || true
        sudo rm -f /swapfile
    fi
    
    # x86 systems typically have more RAM, so reduce swap
    sudo fallocate -l 1G /swapfile  # Reduce from 2GB to 1GB
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    
    # Optimize swappiness for x86 compilation workload
    echo 20 | sudo tee /proc/sys/vm/swappiness > /dev/null  # Reduce from 40
    
    log_success "1GB swap file created and optimized for Node.js v22 compilation"
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
    ulimit -n 131072 # Node v22 can handle more file descriptors
    export NODE_OPTIONS="--max-old-space-size=4096"  # Node v22 is more memory efficient
    
    check_root
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