#!/bin/bash
# =====================================================
# Forex Trading Bot - Setup Automated Backups
# Installs cron job for daily database backups
# =====================================================

set -e

# --- Configuration ---
PROJECT_DIR="/opt/forex-trading-bot"
BACKUP_SCRIPT="$PROJECT_DIR/scripts/backup.sh"
CRON_LOG="$HOME/forex-trading-bot-backups/cron.log"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}info  $1${NC}"; }
log_success() { echo -e "${GREEN}done  $1${NC}"; }
log_warn() { echo -e "${YELLOW}warn  $1${NC}"; }

echo ""
echo "====================================================="
echo "     FOREX TRADING BOT - AUTOMATED BACKUP SETUP"
echo "====================================================="
echo ""

# Ensure backup directory exists
mkdir -p "$HOME/forex-trading-bot-backups"

# Check if backup script exists
if [ ! -f "$BACKUP_SCRIPT" ]; then
    log_warn "Backup script not found at $BACKUP_SCRIPT"
    log_warn "Run this script on the Pi after deployment."
    exit 1
fi

# Define the cron job (daily at 3:00 AM server time). backup.sh takes a
# single-instance lock, pauses entries, requires a flat broker account, and
# briefly stops/restarts the service around the bounded SQLite snapshot.
CRON_JOB="0 3 * * * $BACKUP_SCRIPT >> $CRON_LOG 2>&1"
CRON_MARKER="# forex-trading-bot-backup"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
    log_info "Cron job already exists. Updating..."
    # Remove existing job
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | grep -v "forex-trading-bot.*backup" | crontab -
fi

# Add new cron job
log_info "Installing cron job..."
(crontab -l 2>/dev/null || echo "") | { cat; echo "$CRON_JOB $CRON_MARKER"; } | crontab -

log_success "Cron job installed!"
echo ""
echo "Schedule: Daily at 3:00 AM"
echo "Log file: $CRON_LOG"
echo ""

# Show current cron jobs
log_info "Current cron jobs:"
crontab -l | grep -v "^#" | grep -v "^$" || echo "  (none)"

echo ""
log_success "Automated backups configured!"
echo ""
echo "Commands:"
echo "  View backup log:    tail -f ~/forex-trading-bot-backups/cron.log"
echo "  Manual backup:      $PROJECT_DIR/scripts/backup.sh"
echo "  List backups:       ls -la ~/forex-trading-bot-backups/"
echo "  Remove cron job:    crontab -e (delete the forex line)"
echo ""
