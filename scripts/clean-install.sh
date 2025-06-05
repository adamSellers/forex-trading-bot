#!/bin/bash
# =====================================================
# Crypto Trading Bot - Complete Clean Install Script
# This script completely removes the existing installation
# and performs a fresh install from the git repository
# =====================================================

set -e  # Exit on any error

# Configuration
PROJECT_DIR="/opt/crypto-trading-bot"
PROJECT_USER="adam"
BACKUP_DIR="/opt/crypto-trading-bot-backups"
REPO_URL="https://github.com/yourusername/crypto-trading-bot.git"  # UPDATE THIS
BRANCH="main"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

log_step() {
    echo -e "${PURPLE}🔧 $1${NC}"
}

log_substep() {
    echo -e "${CYAN}   └─ $1${NC}"
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "This script should not be run as root. Run as user '$PROJECT_USER' with sudo access."
    fi
}

# Verify we're running as the correct user
check_user() {
    current_user=$(whoami)
    if [[ "$current_user" != "$PROJECT_USER" ]]; then
        log_error "Script must be run as user '$PROJECT_USER'. Current user: $current_user"
    fi
    log_success "Running as correct user: $PROJECT_USER"
}

# Check system requirements
check_system() {
    log_step "Checking system requirements..."
    
    # Check if we're on a Pi
    if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
        log_warning "Not running on Raspberry Pi hardware"
    else
        log_success "Raspberry Pi detected"
    fi
    
    # Check Node.js is installed and get version
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js first."
    fi
    
    node_version=$(node --version)
    npm_version=$(npm --version)
    log_success "Node.js detected: $node_version, npm: $npm_version"
    
    # Check if Node.js version is compatible (14+)
    node_major=$(echo $node_version | cut -d'.' -f1 | sed 's/v//')
    if [[ $node_major -lt 14 ]]; then
        log_error "Node.js version $node_version is too old. Please upgrade to Node.js 14 or higher."
    fi
    
    # Check available disk space (need at least 2GB)
    available_space=$(df /opt 2>/dev/null | awk 'NR==2 {print $4}' || echo "0")
    required_space=2097152  # 2GB in KB
    
    if [[ $available_space -lt $required_space ]]; then
        log_error "Insufficient disk space. Available: $(($available_space/1024))MB, Required: 2GB"
    fi
    log_success "Sufficient disk space available"
    
    # Check if we have sudo access
    if ! sudo -n true 2>/dev/null; then
        log_error "User $PROJECT_USER needs sudo access without password prompt"
    fi
    log_success "Sudo access verified"
}

# Install system dependencies
install_system_deps() {
    log_step "Installing system dependencies..."
    
    log_substep "Updating package lists..."
    sudo apt-get update -qq
    
    log_substep "Installing required packages..."
    sudo apt-get install -y \
        curl \
        git \
        nginx \
        sqlite3 \
        build-essential \
        python3 \
        python3-pip \
        openssl \
        ufw \
        fail2ban \
        logrotate \
        cron \
        jq
    
    log_success "System dependencies installed"
}

# Configure npm for user (skip Node.js installation)
configure_npm() {
    log_step "Configuring npm for user $PROJECT_USER..."
    
    # Check if npm global prefix is already configured
    current_prefix=$(npm config get prefix)
    desired_prefix="$HOME/.npm-global"
    
    if [[ "$current_prefix" != "$desired_prefix" ]]; then
        log_substep "Setting npm global prefix..."
        npm config set prefix ~/.npm-global
        
        # Add to PATH if not already there
        if ! echo "$PATH" | grep -q ".npm-global/bin"; then
            echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
            export PATH=~/.npm-global/bin:$PATH
        fi
    fi
    
    log_success "npm configured for user $PROJECT_USER"
}

# Install PM2 globally
install_pm2() {
    log_step "Installing PM2 process manager..."
    
    # Check if PM2 is already installed
    if command -v pm2 &> /dev/null; then
        log_substep "PM2 already installed, updating..."
        npm update -g pm2
    else
        log_substep "Installing PM2..."
        npm install -g pm2
    fi
    
    # Configure PM2 to start on boot
    log_substep "Configuring PM2 startup..."
    pm2 startup systemd -u $PROJECT_USER --hp /home/$PROJECT_USER | grep -E '^sudo' | sh || true
    
    log_success "PM2 installed and configured"
}

# Create backup of existing installation
create_backup() {
    if [[ -d "$PROJECT_DIR" ]]; then
        log_step "Creating backup of existing installation..."
        
        # Create backup directory
        timestamp=$(date +%Y%m%d_%H%M%S)
        backup_path="$BACKUP_DIR/backup_$timestamp"
        sudo mkdir -p "$backup_path"
        
        # Backup database if it exists
        if [[ -f "$PROJECT_DIR/backend/data/trading.db" ]]; then
            log_substep "Backing up database..."
            sudo cp "$PROJECT_DIR/backend/data/trading.db" "$backup_path/"
        fi
        
        if [[ -f "$PROJECT_DIR/backend/data/trading_bot.db" ]]; then
            log_substep "Backing up database..."
            sudo cp "$PROJECT_DIR/backend/data/trading_bot.db" "$backup_path/"
        fi
        
        # Backup configuration files
        if [[ -f "$PROJECT_DIR/backend/.env" ]]; then
            log_substep "Backing up configuration..."
            sudo cp "$PROJECT_DIR/backend/.env" "$backup_path/"
        fi
        
        # Backup SSL certificates if they exist
        if [[ -d "$PROJECT_DIR/ssl" ]]; then
            log_substep "Backing up SSL certificates..."
            sudo cp -r "$PROJECT_DIR/ssl" "$backup_path/"
        fi
        
        sudo chown -R $PROJECT_USER:$PROJECT_USER "$backup_path"
        log_success "Backup created at: $backup_path"
    else
        log_info "No existing installation found, skipping backup"
    fi
}

# Stop and remove existing services
stop_services() {
    log_step "Stopping existing services..."
    
    # Stop PM2 processes
    log_substep "Stopping PM2 processes..."
    pm2 stop all || true
    pm2 delete all || true
    
    # Stop nginx
    log_substep "Stopping nginx..."
    sudo systemctl stop nginx || true
    
    log_success "Services stopped"
}

# Remove existing installation
remove_existing() {
    if [[ -d "$PROJECT_DIR" ]]; then
        log_step "Removing existing installation..."
        
        # Remove project directory
        sudo rm -rf "$PROJECT_DIR"
        
        # Remove nginx configuration
        sudo rm -f /etc/nginx/sites-available/crypto-trading-bot
        sudo rm -f /etc/nginx/sites-enabled/crypto-trading-bot
        
        log_success "Existing installation removed"
    fi
}

# Clone fresh repository
clone_repository() {
    log_step "Cloning fresh repository..."
    
    # Create project directory
    sudo mkdir -p "$PROJECT_DIR"
    sudo chown $PROJECT_USER:$PROJECT_USER "$PROJECT_DIR"
    
    # Clone repository
    log_substep "Cloning from $REPO_URL..."
    git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    
    # Set proper ownership
    sudo chown -R $PROJECT_USER:$PROJECT_USER "$PROJECT_DIR"
    
    log_success "Repository cloned successfully"
}

# Install project dependencies using workspace commands
install_dependencies() {
    log_step "Installing project dependencies..."
    
    cd "$PROJECT_DIR"
    
    # Verify package.json exists and has workspaces
    if [[ ! -f "package.json" ]]; then
        log_error "package.json not found in root directory"
    fi
    
    if ! grep -q "workspaces" package.json; then
        log_error "No workspaces configuration found in package.json"
    fi
    
    log_substep "Installing root dependencies..."
    npm install
    
    # Install backend dependencies using workspace command
    log_substep "Installing backend dependencies via workspace..."
    npm run install:backend
    
    # Install frontend dependencies using workspace command  
    log_substep "Installing frontend dependencies via workspace..."
    npm run install:frontend
    
    # Verify installations
    log_substep "Verifying installations..."
    
    if [[ ! -d "backend/node_modules" ]]; then
        log_error "Backend dependencies not installed correctly"
    fi
    
    if [[ ! -d "frontend/node_modules" ]]; then
        log_error "Frontend dependencies not installed correctly"
    fi
    
    # Set up scripts directory and permissions
    log_substep "Setting up scripts directory..."
    mkdir -p scripts
    
    # Make all scripts executable
    if [[ -d "scripts" ]]; then
        chmod +x scripts/*.sh 2>/dev/null || true
    fi
    
    log_success "All dependencies installed successfully"
}

# Build frontend
build_frontend() {
    log_step "Building frontend..."
    
    cd "$PROJECT_DIR"
    
    # Build using workspace command
    log_substep "Running frontend build..."
    npm run build:frontend
    
    # Verify build output
    if [[ ! -d "frontend/dist" ]]; then
        log_error "Frontend build failed - dist directory not found"
    fi
    
    if [[ ! -f "frontend/dist/index.html" ]]; then
        log_error "Frontend build failed - index.html not found"
    fi
    
    log_success "Frontend built successfully"
}

# Setup database
setup_database() {
    log_step "Setting up database..."
    
    cd "$PROJECT_DIR"
    
    # Create data directory
    log_substep "Creating data directory..."
    mkdir -p backend/data
    
    # Fix knexfile.js to use CommonJS syntax if it uses ES6 imports
    log_substep "Fixing knexfile.js syntax..."
    if [[ -f "backend/knexfile.js" ]] && grep -q "^import" backend/knexfile.js 2>/dev/null; then
        log_substep "Converting knexfile.js from ES6 to CommonJS..."
        cat > backend/knexfile.js << 'EOF'
const path = require("path");

module.exports = {
    development: {
        client: "sqlite3",
        connection: {
            filename: path.join(__dirname, "./data/trading.db"),
        },
        useNullAsDefault: true,
        migrations: {
            directory: "./migrations",
        },
    },
    
    production: {
        client: "sqlite3",
        connection: {
            filename: path.join(__dirname, "./data/trading.db"),
        },
        useNullAsDefault: true,
        migrations: {
            directory: "./migrations",
        },
    }
};
EOF
    fi
    
    # Run database migrations with explicit production environment
    log_substep "Running database migrations in production mode..."
    cd backend
    NODE_ENV=production npx knex migrate:latest
    cd ..
    
    # Check what database files actually exist
    log_substep "Checking created database files..."
    ls -la backend/data/ || true
    
    # Verify database was created
    if [[ ! -f "backend/data/trading.db" ]]; then
        log_error "Database setup failed - trading.db not found in backend/data/"
    fi
    
    log_success "Database setup completed with trading.db"
}

# Generate SSL certificates
setup_ssl() {
    log_step "Setting up SSL certificates..."
    
    cd "$PROJECT_DIR"
    
    # Create SSL directory
    mkdir -p ssl
    
    # Generate self-signed certificate
    log_substep "Generating self-signed SSL certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ssl/key.pem \
        -out ssl/cert.pem \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=img.oakroad"
    
    # Set proper permissions
    chmod 600 ssl/key.pem
    chmod 644 ssl/cert.pem
    
    log_success "SSL certificates generated"
}

# Configure nginx
setup_nginx() {
    log_step "Configuring nginx..."
    
    # Create nginx configuration
    log_substep "Creating nginx configuration..."
    sudo tee /etc/nginx/sites-available/crypto-trading-bot > /dev/null << EOF
upstream backend {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 80;
    listen 443 ssl http2;
    
    server_name localhost img img.oakroad;
    
    # SSL Configuration
    ssl_certificate $PROJECT_DIR/ssl/cert.pem;
    ssl_certificate_key $PROJECT_DIR/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security Headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;
    
    # Frontend Static Files
    location / {
        root $PROJECT_DIR/frontend/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            access_log off;
        }
    }
    
    # API Proxy
    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
    
    # Socket.io Proxy
    location /socket.io/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket timeouts
        proxy_connect_timeout 7s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Health Check Endpoint
    location /health {
        proxy_pass http://backend/api/health;
        access_log off;
        
        proxy_connect_timeout 2s;
        proxy_send_timeout 5s;
        proxy_read_timeout 5s;
    }
    
    # Block access to sensitive files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    location ~ \.(env|config|key|pem)$ {
        deny all;
        access_log off;
        log_not_found off;
    }
}
EOF

    # Enable site
    log_substep "Enabling nginx site..."
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo ln -sf /etc/nginx/sites-available/crypto-trading-bot /etc/nginx/sites-enabled/
    
    # Test nginx configuration
    log_substep "Testing nginx configuration..."
    sudo nginx -t
    
    log_success "Nginx configured successfully"
}

# Setup environment variables
setup_environment() {
    log_step "Setting up environment variables..."
    
    cd "$PROJECT_DIR"
    
    # Create backend .env file if it doesn't exist
    if [[ ! -f "backend/.env" ]]; then
        log_substep "Creating backend environment file..."
        cat > backend/.env << EOF
NODE_ENV=production
PORT=3001

# Database
DB_PATH=$PROJECT_DIR/backend/data/trading.db
DB_BACKUP_PATH=$PROJECT_DIR/backend/backups

# Logging
LOG_LEVEL=info
LOG_PATH=$PROJECT_DIR/backend/logs

# Binance API (ADD YOUR KEYS HERE)
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here
USE_REAL_BINANCE_DATA=false

# Security
CORS_ORIGIN=http://localhost:3000,https://localhost:3000,https://img.oakroad
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100

# Trading Safety
MAX_DAILY_LOSS_OVERRIDE=0.01
EMERGENCY_STOP_FILE=$PROJECT_DIR/.emergency_stop

# Performance for Pi
UV_THREADPOOL_SIZE=4
NODE_OPTIONS=--max-old-space-size=512
EOF
    else
        log_substep "Backend .env file already exists, keeping existing configuration"
    fi

    # Create log directory
    mkdir -p backend/logs backend/backups
    
    # Create frontend .env files
    log_substep "Creating frontend environment files..."
    cat > frontend/.env.production << 'EOF'
VITE_API_BASE_URL=
VITE_SOCKET_URL=
EOF

    cat > frontend/.env.development << 'EOF'
VITE_API_BASE_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001
EOF

    log_success "Environment variables configured"
}

# Start services
start_services() {
    log_step "Starting services..."
    
    cd "$PROJECT_DIR"
    
    # Start with PM2
    log_substep "Starting backend with PM2..."
    pm2 start ecosystem.config.js
    
    # Save PM2 configuration
    log_substep "Saving PM2 configuration..."
    pm2 save
    
    # Start nginx
    log_substep "Starting nginx..."
    sudo systemctl enable nginx
    sudo systemctl start nginx
    
    log_success "Services started successfully"
}

# Setup log rotation
setup_logging() {
    log_step "Setting up log rotation..."
    
    sudo tee /etc/logrotate.d/crypto-trading-bot > /dev/null << EOF
$PROJECT_DIR/backend/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    notifempty
    create 0644 $PROJECT_USER $PROJECT_USER
    postrotate
        pm2 reloadLogs
    endscript
}
EOF

    log_success "Log rotation configured"
}

# Setup firewall
setup_firewall() {
    log_step "Configuring firewall..."
    
    # Reset UFW
    log_substep "Resetting UFW..."
    sudo ufw --force reset
    
    # Default policies
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    
    # Allow SSH
    sudo ufw allow ssh
    
    # Allow HTTP and HTTPS
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    
    # Enable UFW
    log_substep "Enabling firewall..."
    sudo ufw --force enable
    
    log_success "Firewall configured"
}

# Create additional scripts that might be missing
create_missing_scripts() {
    log_step "Creating missing utility scripts..."
    
    cd "$PROJECT_DIR"
    
    # Create deploy-check.sh if missing
    if [[ ! -f "scripts/deploy-check.sh" ]]; then
        log_substep "Creating deploy-check.sh..."
        cat > scripts/deploy-check.sh << 'EOF'
#!/bin/bash
set -e

echo "🩺 Running deployment health checks..."

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

check_passed=0
check_failed=0

check() {
    if eval "$2"; then
        echo -e "${GREEN}✅ $1${NC}"
        ((check_passed++))
    else
        echo -e "${RED}❌ $1${NC}"
        ((check_failed++))
    fi
}

# Test current git status
check "Git status clean" "git diff --quiet && git diff --cached --quiet"
check "On main branch" "[[ \$(git branch --show-current) == 'main' ]]"
check "Up to date with origin" "git fetch origin && git diff --quiet HEAD origin/main"

# Test local build
check "Frontend builds successfully" "cd frontend && npm run build > /dev/null 2>&1"
check "Backend dependencies OK" "cd backend && npm ls > /dev/null 2>&1"

# Test workspace configuration
check "Root package.json has workspaces" "grep -q '\"workspaces\"' package.json"
check "Workspace install scripts exist" "grep -q 'install:backend' package.json && grep -q 'install:frontend' package.json"

echo
if [[ $check_failed -eq 0 ]]; then
    echo -e "${GREEN}✅ All checks passed! Ready for deployment.${NC}"
    exit 0
else
    echo -e "${RED}❌ $check_failed checks failed. Fix issues before deploying.${NC}"
    exit 1
fi
EOF
        chmod +x scripts/deploy-check.sh
    fi
    
    # Create status.sh if missing
    if [[ ! -f "scripts/status.sh" ]]; then
        log_substep "Creating status.sh..."
        cat > scripts/status.sh << 'EOF'
#!/bin/bash

echo "📊 Production Status Check"
echo "=========================="

echo "🖥️ System Info:"
echo "  Uptime: $(uptime -p)"
echo "  Memory: $(free -h | grep Mem | awk '{print $3"/"$2}')"
echo "  Disk: $(df -h /opt/crypto-trading-bot | tail -1 | awk '{print $3"/"$2" ("$5" used)"}')"
echo

echo "🔧 PM2 Status:"
pm2 jlist 2>/dev/null | jq -r '.[] | "  \(.name): \(.pm2_env.status) (CPU: \(.monit.cpu)%, Memory: \(.monit.memory/1024/1024 | floor)MB)"' 2>/dev/null || pm2 list
echo

echo "🌐 Nginx Status:"
if systemctl is-active --quiet nginx; then
    echo "  Status: ✅ Running"
else
    echo "  Status: ❌ Stopped"
fi
echo

echo "🩺 Health Check:"
if curl -f -s http://localhost:3001/api/health > /dev/null; then
    echo "  API: ✅ Responding"
    health_data=$(curl -s http://localhost:3001/api/health)
    echo "  Uptime: $(echo $health_data | jq -r '.uptime' | awk '{printf "%.1f hours", $1/3600}')"
else
    echo "  API: ❌ Not responding"
fi

if curl -f -s -k https://localhost/ > /dev/null; then
    echo "  HTTPS: ✅ Responding"
else
    echo "  HTTPS: ❌ Not responding"
fi
EOF
        chmod +x scripts/status.sh
    fi
    
    # Create logs.sh if missing
    if [[ ! -f "scripts/logs.sh" ]]; then
        log_substep "Creating logs.sh..."
        cat > scripts/logs.sh << 'EOF'
#!/bin/bash

case "$1" in
    "pm2"|"")
        echo "📋 PM2 Logs:"
        pm2 logs img-backend --lines 50
        ;;
    "nginx")
        echo "📋 Nginx Access Logs:"
        sudo tail -f /var/log/nginx/access.log
        ;;
    "nginx-error")
        echo "📋 Nginx Error Logs:"
        sudo tail -f /var/log/nginx/error.log
        ;;
    "app")
        echo "📋 Application Logs:"
        tail -f /opt/crypto-trading-bot/backend/logs/*.log
        ;;
    *)
        echo "Usage: $0 [pm2|nginx|nginx-error|app]"
        echo "  pm2         - PM2 process logs (default)"
        echo "  nginx       - Nginx access logs"
        echo "  nginx-error - Nginx error logs"
        echo "  app         - Application logs"
        ;;
esac
EOF
        chmod +x scripts/logs.sh
    fi
    
    log_success "Utility scripts created"
}

# Health check
health_check() {
    log_step "Running health checks..."
    
    # Wait for services to start
    sleep 10
    
    # Check PM2 process
    log_substep "Checking PM2 process..."
    if pm2 list | grep -q "img-backend.*online"; then
        log_success "PM2 process running"
    else
        log_error "PM2 process not running"
    fi
    
    # Check backend API
    log_substep "Checking backend API..."
    max_attempts=30
    attempt=0
    
    while [[ $attempt -lt $max_attempts ]]; do
        if curl -f -s http://localhost:3001/api/health > /dev/null 2>&1; then
            log_success "Backend API responding"
            break
        fi
        
        attempt=$((attempt + 1))
        sleep 2
    done
    
    if [[ $attempt -eq $max_attempts ]]; then
        log_error "Backend API not responding after $max_attempts attempts"
    fi
    
    # Check nginx
    log_substep "Checking nginx..."
    if sudo systemctl is-active --quiet nginx; then
        log_success "Nginx running"
    else
        log_error "Nginx not running"
    fi
    
    # Check HTTPS endpoint
    log_substep "Checking HTTPS endpoint..."
    if curl -f -s -k https://localhost/health > /dev/null 2>&1; then
        log_success "HTTPS endpoint responding"
    else
        log_warning "HTTPS endpoint not responding (may need DNS configuration)"
    fi
}

# Print summary
print_summary() {
    echo
    echo "=============================================="
    echo -e "${GREEN}🎉 INSTALLATION COMPLETED SUCCESSFULLY! 🎉${NC}"
    echo "=============================================="
    echo
    echo "📊 Dashboard URLs:"
    echo "   • Local: https://localhost"
    echo "   • Domain: https://img.oakroad (requires DNS)"
    echo
    echo "🔧 Management Commands:"
    echo "   • View logs: ./scripts/logs.sh"
    echo "   • Check status: ./scripts/status.sh"
    echo "   • Deploy updates: ./scripts/deploy.sh"
    echo "   • Quick status: pm2 status"
    echo "   • Restart: pm2 restart img-backend"
    echo "   • Stop: pm2 stop img-backend"
    echo
    echo "📁 Important Locations:"
    echo "   • Project: $PROJECT_DIR"
    echo "   • Logs: $PROJECT_DIR/backend/logs"
    echo "   • Database: $PROJECT_DIR/backend/data/"
    echo "   • Backups: $BACKUP_DIR"
    echo "   • Scripts: $PROJECT_DIR/scripts/"
    echo
    echo "⚠️  IMPORTANT NEXT STEPS:"
    echo "   1. Edit $PROJECT_DIR/backend/.env to add your Binance API keys"
    echo "   2. Configure your local DNS to point img.oakroad to this Pi"
    echo "   3. Review the dashboard at https://localhost"
    echo "   4. Run './scripts/status.sh' to check system health"
    echo
    echo "🆘 Need help? Check the logs:"
    echo "   ./scripts/logs.sh pm2"
    echo "   ./scripts/logs.sh nginx-error"
    echo
    echo "📋 Available Scripts:"
    echo "   ./scripts/status.sh       - System status overview"
    echo "   ./scripts/logs.sh         - View various logs"
    echo "   ./scripts/deploy-check.sh - Pre-deployment validation"
    echo "   ./scripts/backup.sh       - Create backup"
    echo "   ./scripts/monitor.sh      - System monitoring"
    echo
}

# Main execution
main() {
    echo "=============================================="
    echo -e "${PURPLE}🚀 Crypto Trading Bot - Clean Install${NC}"
    echo "=============================================="
    echo
    
    log_info "Starting clean installation process..."
    echo
    
    # Prompt for repository URL if not set
    if [[ "$REPO_URL" == "https://github.com/yourusername/crypto-trading-bot.git" ]]; then
        echo -n "Enter your Git repository URL: "
        read -r REPO_URL
        if [[ -z "$REPO_URL" ]]; then
            log_error "Repository URL is required"
        fi
    fi
    
    # Confirmation prompt
    echo -e "${YELLOW}This will completely remove the existing installation and perform a fresh install.${NC}"
    echo -n "Continue? (y/N): "
    read -r confirmation
    
    if [[ ! "$confirmation" =~ ^[Yy]$ ]]; then
        log_info "Installation cancelled by user"
        exit 0
    fi
    
    echo
    
    # Run installation steps
    check_root
    check_user
    check_system
    install_system_deps
    configure_npm
    install_pm2
    create_backup
    stop_services
    remove_existing
    clone_repository
    install_dependencies
    build_frontend
    setup_database
    setup_ssl
    setup_nginx
    setup_environment
    setup_logging
    setup_firewall
    create_missing_scripts
    start_services
    health_check
    print_summary
}

# Run main function
main "$@"