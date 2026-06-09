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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"

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

# Create backup (excludes node_modules, logs, and large generated files).
# The live SQLite files are excluded: tar-ing a multi-GB WAL-mode database on
# every run is what was filling the SD card, and a raw copy without its WAL is
# inconsistent anyway. The database is snapshotted separately below.
tar -czf "$BACKUP_DIR/$BACKUP_FILE" \
    --exclude='node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='backend/node_modules' \
    --exclude='*.log' \
    --exclude='backend/logs/*' \
    --exclude='frontend/dist' \
    --exclude='backend/data/trading.db*' \
    -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")"

log_success "Backup created: $BACKUP_DIR/$BACKUP_FILE"

# Database snapshot (quick restore option).
# sqlite3 .backup takes a consistent point-in-time copy with the WAL contents
# folded in — a plain cp of a WAL-mode database silently drops transactions
# still sitting in trading.db-wal.
if [ -f "$PROJECT_DIR/backend/data/trading.db" ]; then
    DB_SNAPSHOT="$BACKUP_DIR/trading_${TIMESTAMP}.db"
    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 -cmd ".timeout 5000" "$PROJECT_DIR/backend/data/trading.db" \
            ".backup '$DB_SNAPSHOT'"
    else
        cp "$PROJECT_DIR/backend/data/trading.db" "$DB_SNAPSHOT"
        cp "$PROJECT_DIR/backend/data/trading.db-wal" "$DB_SNAPSHOT-wal" 2>/dev/null || true
        cp "$PROJECT_DIR/backend/data/trading.db-shm" "$DB_SNAPSHOT-shm" 2>/dev/null || true
    fi
    log_success "Database backup: $DB_SNAPSHOT"
fi

# Clean old backups (keep the latest 2 of each — the Pi SD card is small)
log_info "Cleaning old backups..."
MAX_KEEP=2
ls -tp "$BACKUP_DIR"/forex_backup_*.tar.gz 2>/dev/null | tail -n +$((MAX_KEEP + 1)) | xargs -r rm -f
ls -tp "$BACKUP_DIR"/pre_restore_*.tar.gz 2>/dev/null | tail -n +$((MAX_KEEP + 1)) | xargs -r rm -f
ls -tp "$BACKUP_DIR"/pre_restore_*.db 2>/dev/null | tail -n +$((MAX_KEEP + 1)) | xargs -r rm -f
# DB snapshots may have legacy -wal/-shm companions; remove them with their .db
while IFS= read -r old_db; do
    rm -f "$old_db" "$old_db-wal" "$old_db-shm"
done < <(ls -t "$BACKUP_DIR"/trading_*.db 2>/dev/null | tail -n +$((MAX_KEEP + 1)))

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
