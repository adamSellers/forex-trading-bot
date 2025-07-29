#!/bin/bash
# =====================================================
# Crypto Trading Bot - Lightweight Update Script
# Pulls latest changes, installs deps, and restarts.
# Does NOT wipe data.
# =====================================================

set -e # Exit on any error

# --- Configuration ---
APP_NAME="crypto-trend-bot"
PROJECT_DIR="/opt/crypto-trading-bot"
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

# --- Main Logic ---
main() {
    log_step "Starting lightweight update process..."
    cd "$PROJECT_DIR" || log_error "Project directory $PROJECT_DIR not found."

    # 1. Fetch the latest changes from the remote
    log_substep "Fetching latest changes from origin..."
    git fetch origin

    # 2. Get current and remote commit hashes
    local before_hash=$(git rev-parse HEAD)
    local after_hash=$(git rev-parse "origin/$BRANCH")

    # 3. Forcefully reset the local branch to match the remote, discarding local changes
    log_warning "Resetting local branch to match remote 'origin/$BRANCH'..."
    git reset --hard "origin/$BRANCH"
    log_success "Local branch reset. New commit: ${after_hash:0:7}"

    if [ "$before_hash" == "$after_hash" ]; then
        log_success "Already up-to-date. No new code to deploy."
        exit 0
    fi

    log_success "Code updated successfully. New commit: ${after_hash:0:7}"

    # 4. Check what changed to run tasks conditionally
    log_step "Analyzing changes..."
    local changed_files=$(git diff --name-only "$before_hash" "$after_hash")

    local backend_changed=false
    local frontend_changed=false
    local deps_changed=false

    if echo "$changed_files" | grep -q -E "backend/|package.json|package-lock.json|npm-shrinkwrap.json"; then
        backend_changed=true
        log_substep "Backend changes detected."
    fi
    if echo "$changed_files" | grep -q -E "frontend/|vite.config.js"; then
        frontend_changed=true
        log_substep "Frontend changes detected."
    fi
    if echo "$changed_files" | grep -q "package.json"; then
        deps_changed=true
        log_substep "Dependency changes detected in package.json."
    fi

    # 5. Install dependencies if needed
    if [ "$deps_changed" = true ]; then
        log_step "Installing/updating dependencies..."
        npm install
        log_success "Dependencies updated."
    else
        log_info "No dependency changes detected, skipping install."
    fi

    # 6. Build frontend if needed
    if [ "$frontend_changed" = true ]; then
        log_step "Rebuilding frontend..."
        npm run build:frontend
        log_success "Frontend rebuilt."
    else
        log_info "No frontend changes detected, skipping build."
    fi

    # 7. Run database migrations (always safe to run)
    log_step "Running database migrations..."
    NODE_ENV=production npm run db:migrate
    log_success "Database migrations completed."

    # 8. Restart the application gracefully
    log_step "Restarting application with PM2..."
    pm2 reload ecosystem.config.js --env production
    pm2 save
    log_success "Application reloaded gracefully."

    # 10. Health check
    log_step "Performing health check..."
    sleep 5 # Give the server a moment to start
    if curl -sf http://localhost:3001/api/management/health > /dev/null 2>&1; then
        log_success "Health check passed! Application is online."
    else
        log_error "Health check failed. Check logs with 'pm2 logs $APP_NAME'."
    fi

    echo
    log_success "🎉 Lightweight update complete! 🎉"
    echo
    pm2 status
}

# Run main function
main "$@"