#!/bin/bash
# =====================================================
# Forex Trading Bot - Quick Update Script
# Pulls latest code and restarts (preserves data)
# =====================================================

set -e

# --- Configuration ---
APP_NAME="forex-backend"
PROJECT_DIR="/opt/forex-trading-bot"
BRANCH="main"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "         🔄 FOREX TRADING BOT - QUICK UPDATE"
echo "═══════════════════════════════════════════════════════════"
echo ""

cd "$PROJECT_DIR" || log_error "Project directory not found"

# Get current state
before_hash=$(git rev-parse HEAD)
log_info "Current commit: ${before_hash:0:7}"

# Fetch and check for changes
log_info "Fetching latest changes..."
git fetch origin "$BRANCH"

after_hash=$(git rev-parse "origin/$BRANCH")

if [ "$before_hash" = "$after_hash" ]; then
    log_success "Already up-to-date. No changes to deploy."
    exit 0
fi

log_info "New commit available: ${after_hash:0:7}"

# Show what changed
echo ""
log_info "Changes:"
git log --oneline "$before_hash..$after_hash" | head -10
echo ""

# Analyze changes
changed_files=$(git diff --name-only "$before_hash" "$after_hash")

backend_changed=false
frontend_changed=false
deps_changed=false

echo "$changed_files" | grep -qE "^backend/" && backend_changed=true
echo "$changed_files" | grep -qE "^frontend/" && frontend_changed=true
echo "$changed_files" | grep -q "package.json" && deps_changed=true

log_info "Backend changes: $backend_changed"
log_info "Frontend changes: $frontend_changed"
log_info "Dependency changes: $deps_changed"
echo ""

# Apply changes
log_warn "Applying update..."
git reset --hard "origin/$BRANCH"
chmod +x scripts/*.sh 2>/dev/null || true

# Install dependencies if needed
if [ "$deps_changed" = true ]; then
    log_info "Updating backend dependencies..."
    cd backend && npm install --omit=dev && cd ..
fi

# Rebuild frontend if needed
if [ "$frontend_changed" = true ]; then
    log_info "Rebuilding frontend..."
    cd frontend
    npm install
    npm install @rollup/rollup-linux-arm64-gnu --no-save 2>/dev/null || true
    NODE_OPTIONS="--max-old-space-size=2048" NODE_ENV=production npm run build
    cd ..
fi

# Run migrations
log_info "Running database migrations..."
cd backend && npm run db:migrate 2>/dev/null || true && cd ..

# Graceful reload
log_info "Reloading application..."
pm2 reload "$APP_NAME" --env production 2>/dev/null || pm2 restart "$APP_NAME" --env production
pm2 save

# Health check
log_info "Health check..."
sleep 5
max_attempts=6
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if curl -sf http://localhost:3101/api/health > /dev/null 2>&1; then
        break
    fi
    attempt=$((attempt + 1))
    sleep 3
done

if [ $attempt -lt $max_attempts ]; then
    log_success "Health check passed!"
else
    log_warn "Health check pending - check logs"
fi

echo ""
log_success "🎉 Update complete! (${before_hash:0:7} → ${after_hash:0:7})"
echo ""
pm2 status | grep -E "forex|Name"
