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

    # 1. Stash local changes if they exist
    local stashed=false
    if ! git diff --quiet HEAD; then
        log_warning "Uncommitted changes detected. Stashing them before update..."
        git stash push -m "update-script-stash-$(date +%s)"
        stashed=true
        log_success "Local changes stashed."
    else
        log_substep "No local changes detected."
    fi

    # 2. Get the commit hash before pulling
    log_substep "Fetching latest changes from origin..."
    git fetch origin
    local before_hash=$(git rev-parse HEAD)

    # 3. Pull latest code
    log_substep "Pulling latest code from branch '$BRANCH'..."
    git pull origin "$BRANCH"
    local after_hash=$(git rev-parse HEAD)

    if [ "$before_hash" == "$after_hash" ]; then
        log_success "Already up-to-date. No new code to deploy."
        # If nothing changed, pop the stash back
        if [ "$stashed" = true ]; then
            log_substep "Re-applying stashed changes..."
            if ! git stash pop; then
                log_warning "Could not automatically re-apply stashed changes."
                log_warning "Run 'git status' and 'git diff' to resolve them."
                log_warning "Your changes are saved in the latest stash. Run 'git stash list'."
            else
                log_success "Stashed changes re-applied."
            fi
        fi
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
    npm run db:migrate
    log_success "Database migrations completed."

    # 8. Restart the application gracefully
    log_step "Restarting application with PM2..."
    pm2 reload "$APP_NAME" --env production
    pm2 save
    log_success "Application reloaded gracefully."

    # 9. Re-apply stashed changes
    if [ "$stashed" = true ]; then
        log_step "Re-applying stashed changes..."
        if ! git stash pop; then
            log_warning "Could not automatically re-apply stashed changes. You may have merge conflicts."
            log_warning "Run 'git status' and 'git diff' to resolve them."
            log_warning "Your changes are saved in the latest stash. Run 'git stash list' to see it."
        else
            log_success "Stashed changes re-applied successfully."
        fi
    fi

    # 9. Health check
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