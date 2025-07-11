#!/bin/bash
# =====================================================
# Crypto Trading Bot - Restore from Backup
# Use this script to restore the entire application
# state from a previously created backup.
# =====================================================

set -e

# --- Configuration ---
APP_NAME="crypto-trend-bot"
PROJECT_DIR="/opt/crypto-trading-bot"
PROJECT_USER="adam" # This should match the user running the app
# This script is for disaster recovery, so it should ONLY look in the safe, external directory.
# This prevents accidentally restoring from an old, internal backup.
BACKUP_DIR="/opt/crypto-trading-bot-backups"


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
    log_step "Starting application restore process..."

    if [ "$(whoami)" != "$PROJECT_USER" ]; then
        log_error "This script must be run as user '$PROJECT_USER'."
    fi

    # 1. Find and select a backup
    log_substep "Finding available backups in the safe directory: $BACKUP_DIR..."
    backups=($(ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null))

    if [ ${#backups[@]} -eq 0 ]; then
        log_error "No backups found in $BACKUP_DIR. Cannot restore. Please ensure backups exist there."
    fi

    log_info "Please select a backup to restore from:"
    select backup_file in "${backups[@]}"; do
        if [ -n "$backup_file" ]; then
            break
        else
            log_warning "Invalid selection. Please try again."
        fi
    done

    log_info "You have selected: $(basename "$backup_file")"
    read -p "This will completely overwrite the current application. Are you sure? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Restore cancelled."
        exit 0
    fi

    # 2. Stop the application
    log_step "Stopping the application..."
    pm2 stop "$APP_NAME" --silent || true
    pm2 delete "$APP_NAME" --silent || true
    pm2 save --force
    sleep 2

    # 3. Secure the backup file
    log_step "Securing backup file before restore..."
    local temp_backup_path="/tmp/restore_$(basename "$backup_file")"
    cp "$backup_file" "$temp_backup_path"
    log_success "Backup file secured at $temp_backup_path"

    # 4. Remove the old project directory
    log_step "Removing current installation..."
    sudo rm -rf "$PROJECT_DIR"

    # 5. Restore from the secured backup file
    log_step "Extracting backup archive from temporary location..."
    # The backup was created with -C /opt, so we extract it back into /opt
    # This correctly re-creates the /opt/crypto-trading-bot directory
    sudo tar -xzf "$temp_backup_path" -C /opt
    log_success "Backup extracted to $PROJECT_DIR"

    # 6. Clean up the temporary file
    log_substep "Cleaning up temporary backup file..."
    rm -f "$temp_backup_path"

    # 7. Set correct permissions
    log_step "Setting permissions..."
    sudo chown -R "$PROJECT_USER":"$PROJECT_USER" "$PROJECT_DIR"
    chmod +x "$PROJECT_DIR/scripts/"*.sh

    # 8. Re-install dependencies to match the current system environment
    log_step "Re-installing dependencies..."
    cd "$PROJECT_DIR"
    log_substep "Installing backend dependencies..."
    npm run install:backend -- --omit=dev --no-optional
    log_substep "Installing frontend dependencies..."
    npm run install:frontend -- --omit=dev --no-optional
    log_success "Dependencies installed."

    # 9. Re-build frontend
    log_step "Re-building frontend..."
    npm run build:frontend
    log_success "Frontend built."

    # 10. Restart the application
    log_step "Restarting application from restored state..."
    cd "$PROJECT_DIR"
    pm2 start ecosystem.config.js --env production
    pm2 save

    log_success "🎉 Restore complete! The application is now running from the state of $(basename "$backup_file")."
    pm2 status
}

main "$@"