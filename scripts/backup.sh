#!/bin/bash
# =====================================================
# Forex Trading Bot - Backup Script
# Creates timestamped backup of database and config
# =====================================================

set -e

# --- Configuration ---
APP_NAME="forex-backend"
PROJECT_DIR="/opt/forex-trading-bot"
BACKUP_DIR="$HOME/forex-trading-bot-backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="forex_backup_${TIMESTAMP}.tar.gz"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }

echo "📦 Creating Forex Trading Bot backup..."

mkdir -p "$BACKUP_DIR"

# Check if service is running
was_running=false
if pm2 list | grep -q "$APP_NAME.*online"; then
    was_running=true
fi

# Stop for consistent backup (optional - can be removed for hot backups)
if [ "$was_running" = true ] && [ "$1" = "--cold" ]; then
    log_info "Stopping service for consistent backup..."
    pm2 stop "$APP_NAME" --silent
    sleep 2
fi

log_info "Creating archive..."

# Create backup (excludes node_modules, logs, and large generated files)
tar -czf "$BACKUP_DIR/$BACKUP_FILE" \
    --exclude='node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='backend/node_modules' \
    --exclude='*.log' \
    --exclude='backend/logs/*' \
    --exclude='frontend/dist' \
    -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")"

log_success "Backup created: $BACKUP_DIR/$BACKUP_FILE"

# Database-only backup (quick restore option)
if [ -f "$PROJECT_DIR/backend/data/trading.db" ]; then
    cp "$PROJECT_DIR/backend/data/trading.db" "$BACKUP_DIR/trading_${TIMESTAMP}.db"
    log_success "Database backup: $BACKUP_DIR/trading_${TIMESTAMP}.db"
fi

# Clean old backups (keep last 7 full, last 14 DB-only)
log_info "Cleaning old backups..."
ls -tp "$BACKUP_DIR"/forex_backup_*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -tp "$BACKUP_DIR"/trading_*.db 2>/dev/null | tail -n +15 | xargs -r rm -f

# Restart if was running
if [ "$was_running" = true ] && [ "$1" = "--cold" ]; then
    log_info "Restarting service..."
    pm2 start "$APP_NAME" --env production
fi

# Log backup completion
echo "$(date): Backup completed - $BACKUP_FILE" >> "$BACKUP_DIR/backup.log"

log_success "Backup complete!"
echo ""
echo "Files:"
ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -3
echo ""
echo "Disk usage: $(du -sh "$BACKUP_DIR" | cut -f1)"
