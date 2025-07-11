#!/bin/bash

# ===================================================
# scripts/local-deploy.sh - Direct deployment on Pi
# Use this when deploying directly on the Raspberry Pi
# ===================================================

set -e

# --- Configuration ---
PROJECT_DIR="/opt/crypto-trading-bot"
BACKUP_DIR="$HOME/crypto-trading-bot-backups" # Use user's home directory for backups
APP_NAME="crypto-trend-bot"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

echo "🚀 Starting local deployment on Raspberry Pi..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    log_error "Not in project root directory. Please run from /opt/crypto-trading-bot"
    exit 1
fi

# Check if we're the right user
if [ "$(whoami)" != "adam" ]; then
    log_error "Please run as user 'adam'"
    exit 1
fi

# 0. Update code from git
log_info "Fetching latest changes from git..."
git fetch origin main

log_info "Resetting local branch to match remote (discards local changes)..."
git reset --hard origin/main
log_success "Code is up to date."

# --- CRITICAL FIX: Restore persistent data from the backup ---
log_info "Restoring persistent data (database and portfolio state)..."
latest_backup=$(ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | head -1)
if [ -n "$latest_backup" ]; then
    # Restore only the data directory into the project directory, overwriting what's there.
    # The -C /opt ensures extraction happens relative to the root of the backup.
    # The tar command will overwrite the empty 'data' directory from git with the one from the backup.
    tar -xvf "$latest_backup" -C /opt crypto-trading-bot/backend/data
    log_success "Persistent data restored from backup."
fi

# 0.5 Set executable permissions on all scripts
log_info "Ensuring all scripts are executable..."
chmod +x scripts/*.sh
log_success "Script permissions set."

# 1. Pre-deployment checks
log_info "Running pre-deployment checks..."

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
    log_warning "Node.js version $NODE_VERSION detected. Recommended: v22+"
fi

# Check if PM2 is running our app
if ! pm2 list | grep -q "$APP_NAME"; then
    log_warning "PM2 app '$APP_NAME' not found. Will start after deployment."
fi

# Check git status (if this is a git repo)
if [ -d ".git" ]; then
    if ! git diff --quiet; then
        log_warning "Uncommitted changes detected in git"
    fi
fi

# 2. Create backup
log_info "Creating backup before deployment..."
./scripts/backup.sh

# 3. Update dependencies
log_info "Updating dependencies using workspace scripts..."
log_info "Updating backend dependencies..."
npm run install:backend -- --omit=dev --no-optional
log_info "Updating frontend dependencies..."
npm run install:frontend -- --omit=dev --no-optional

# 4. Build frontend
log_info "Building frontend for production..."
npm run build:frontend

if [ ! -d "frontend/dist" ]; then
    log_error "Frontend build failed - dist directory not created"
    exit 1
fi

# 5. Reload Nginx to serve the new frontend
log_info "Reloading Nginx to serve new frontend build..."
sudo systemctl reload nginx

# 5. Run database migrations
log_info "Running database migrations..."
npm run db:migrate

# 6. Update PM2 process
log_info "Updating PM2 process..."

# Check if app is running
if pm2 list | grep -q "$APP_NAME.*online"; then
    log_info "Reloading existing PM2 process..."
    pm2 reload ecosystem.config.js --env production
else
    log_info "Starting new PM2 process..."
    pm2 start ecosystem.config.js --env production
fi

# Save PM2 configuration
pm2 save

# 7. Wait for service to become healthy (with retries)
log_info "Waiting for service to become healthy..."
max_attempts=12 # 12 attempts * 5 seconds = 60 seconds timeout
attempt=0
until curl -f -s http://localhost:3001/api/management/health | jq -e '.services.tradingController == true and .services.binanceData == true' > /dev/null 2>&1; do
    attempt=$((attempt+1))
    if [ $attempt -ge $max_attempts ]; then
        log_error "Health check failed after $max_attempts attempts."
        pm2 status
        pm2 logs $APP_NAME --lines 20
        # Add detailed health check output for debugging
        echo "Last health check response:"
        curl -s http://localhost:3001/api/management/health | jq .
        exit 1
    fi
    echo -n "." # Progress indicator
    sleep 5
done
echo "" # Newline after progress dots
log_success "Health check passed!"

# 9. Show status
log_info "Deployment status:"
pm2 status
echo ""

# 10. Check memory usage
MEMORY_USAGE=$(free -m | awk 'NR==2{printf "%.1f%%", $3*100/$2}')
log_info "Current memory usage: $MEMORY_USAGE"

# 11. Show recent logs
log_info "Recent application logs:"
pm2 logs $APP_NAME --lines 5 --nostream

echo ""
log_success "🎉 Local deployment completed!"
echo ""
echo "📊 Dashboard URL: https://img.oakroad"
echo "🔧 Commands:"
echo "  • View logs:     pm2 logs $APP_NAME"
echo "  • Check status:  pm2 status"
echo "  • Restart app:   pm2 restart $APP_NAME"
echo "  • Stop app:      pm2 stop $APP_NAME"
echo ""

# Check if app is responding
if curl -f -s http://localhost:3001/api/management/health > /dev/null; then
    log_success "✅ Application is responding correctly"
else
    log_warning "⚠️ Application may not be responding. Check logs above."
fi