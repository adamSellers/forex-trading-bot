#!/bin/bash

# ===================================================
# scripts/deploy.sh - Fixed for ARM64 Dependencies
# ===================================================

set -e

# --- Configuration ---
PROJECT_DIR="/opt/crypto-trading-bot"
BACKUP_DIR="$HOME/crypto-trading-bot-backups"
APP_NAME="crypto-trend-bot"

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

echo "🚀 Starting local deployment on Raspberry Pi..."

# Validation
if [ ! -f "package.json" ]; then
    log_error "Run from project root (/opt/crypto-trading-bot)"
    exit 1
fi

if [ "$(whoami)" != "adam" ]; then
    log_error "Please run as user 'adam'"
    exit 1
fi

# 0. Update code
log_info "Fetching latest changes..."
git fetch origin main
log_info "Resetting local branch..."
git reset --hard origin/main
chmod +x scripts/*.sh

# 1. Stop Service
log_info "Stopping service..."
pm2 stop "$APP_NAME" --silent || true
sleep 2

# 2. Backup
log_info "Creating backup..."
./scripts/backup.sh

# 3. Update Dependencies (FIXED)
log_info "Updating dependencies..."

# Backend: Keep it lean (Production deps only)
log_info "Backend: Installing production dependencies..."
npm run install:backend -- --omit=dev

# Frontend: MUST install ALL dependencies (Dev + Optional) for build tools (Vite/Esbuild) to work
log_info "Frontend: Installing build dependencies (ARM64 binaries)..."
npm run install:frontend

# 4. Build Frontend
log_info "Building frontend..."
# Explicitly install the Linux ARM64 Rollup binary to prevent Vite hangs
cd frontend
npm install @rollup/rollup-linux-arm64-gnu --no-save
cd ..

# Run build with memory constraints and NO source maps
NODE_OPTIONS="--max-old-space-size=2048" NODE_ENV=production GENERATE_SOURCEMAP=false npm run build:frontend

if [ ! -d "frontend/dist" ]; then
    log_error "Frontend build failed."
    exit 1
fi

# 5. Reload Nginx
log_info "Reloading Nginx..."
sudo systemctl reload nginx

# 6. Migrations
log_info "Running database migrations..."
npm run db:migrate

# 7. Restart
log_info "Restarting Application..."
pm2 restart ecosystem.config.js --env production
pm2 save

# 8. Health Check
log_info "Waiting for health check..."
max_attempts=12
attempt=0
until curl -f -s http://localhost:3001/api/management/health | jq -e '.services.tradingController == true' > /dev/null 2>&1; do
    attempt=$((attempt+1))
    if [ $attempt -ge $max_attempts ]; then
        log_error "Health check failed."
        pm2 logs $APP_NAME --lines 20
        exit 1
    fi
    echo -n "."
    sleep 5
done

echo ""
log_success "Health check passed!"
log_success "🎉 Deployment Complete!"