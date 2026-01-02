#!/bin/bash
# =====================================================
# Forex Trading Bot - Restore from Backup
# Restores application state from a backup archive
# =====================================================

set -e

# --- Configuration ---
APP_NAME="forex-backend"
PROJECT_DIR="/opt/forex-trading-bot"
PROJECT_USER=$(whoami)
BACKUP_DIR="$HOME/forex-trading-bot-backups"

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
echo "         🔄 FOREX TRADING BOT - RESTORE FROM BACKUP"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Validate user
if [ "$(whoami)" != "$PROJECT_USER" ]; then
    log_error "Run as user '$PROJECT_USER'"
fi

# Find backups
log_info "Finding available backups in $BACKUP_DIR..."

# Check for full backups
full_backups=($(ls -t "$BACKUP_DIR"/forex_backup_*.tar.gz 2>/dev/null || true))
db_backups=($(ls -t "$BACKUP_DIR"/trading_*.db 2>/dev/null || true))

if [ ${#full_backups[@]} -eq 0 ] && [ ${#db_backups[@]} -eq 0 ]; then
    log_error "No backups found in $BACKUP_DIR"
fi

echo ""
echo "Available backups:"
echo ""
echo "Full Backups (code + data):"
if [ ${#full_backups[@]} -gt 0 ]; then
    for i in "${!full_backups[@]}"; do
        size=$(du -h "${full_backups[$i]}" | cut -f1)
        name=$(basename "${full_backups[$i]}")
        echo "  [$((i+1))] $name ($size)"
    done
else
    echo "  None"
fi

echo ""
echo "Database-only Backups:"
if [ ${#db_backups[@]} -gt 0 ]; then
    offset=${#full_backups[@]}
    for i in "${!db_backups[@]}"; do
        size=$(du -h "${db_backups[$i]}" | cut -f1)
        name=$(basename "${db_backups[$i]}")
        echo "  [$((offset+i+1))] $name ($size) [DB ONLY]"
    done
else
    echo "  None"
fi

echo ""
read -p "Select backup number (or 'q' to quit): " selection

if [ "$selection" = "q" ]; then
    log_info "Restore cancelled."
    exit 0
fi

# Determine which backup was selected
total_full=${#full_backups[@]}
if [ "$selection" -le "$total_full" ] 2>/dev/null; then
    backup_file="${full_backups[$((selection-1))]}"
    restore_type="full"
else
    db_index=$((selection - total_full - 1))
    if [ "$db_index" -ge 0 ] && [ "$db_index" -lt "${#db_backups[@]}" ]; then
        backup_file="${db_backups[$db_index]}"
        restore_type="db"
    else
        log_error "Invalid selection"
    fi
fi

echo ""
log_info "Selected: $(basename "$backup_file")"
log_info "Restore type: $restore_type"
echo ""
log_warn "This will overwrite current data!"
read -p "Are you sure? (yes/N): " confirm

if [ "$confirm" != "yes" ]; then
    log_info "Restore cancelled."
    exit 0
fi

# Stop the service
log_info "Stopping service..."
pm2 stop "$APP_NAME" --silent 2>/dev/null || true
pm2 delete "$APP_NAME" --silent 2>/dev/null || true
sleep 2

if [ "$restore_type" = "full" ]; then
    # Full restore
    log_info "Creating safety backup of current state..."
    if [ -d "$PROJECT_DIR" ]; then
        tar -czf "$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).tar.gz" \
            --exclude='node_modules' \
            -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")" 2>/dev/null || true
    fi
    
    log_info "Removing current installation..."
    sudo rm -rf "$PROJECT_DIR"
    
    log_info "Extracting backup..."
    sudo tar -xzf "$backup_file" -C /opt
    sudo chown -R "$PROJECT_USER:$PROJECT_USER" "$PROJECT_DIR"
    
    log_info "Reinstalling dependencies..."
    cd "$PROJECT_DIR/backend"
    npm install --omit=dev
    
    if [ -d "$PROJECT_DIR/frontend" ]; then
        cd "$PROJECT_DIR/frontend"
        npm install
        npm install @rollup/rollup-linux-arm64-gnu --no-save 2>/dev/null || true
        
        log_info "Rebuilding frontend..."
        NODE_OPTIONS="--max-old-space-size=2048" NODE_ENV=production npm run build
    fi
    
    chmod +x "$PROJECT_DIR/scripts/"*.sh 2>/dev/null || true
    
else
    # Database-only restore
    log_info "Restoring database..."
    cp "$backup_file" "$PROJECT_DIR/backend/data/trading.db"
    chown "$PROJECT_USER:$PROJECT_USER" "$PROJECT_DIR/backend/data/trading.db"
fi

# Restart service
log_info "Starting service..."
cd "$PROJECT_DIR"
pm2 start ecosystem.config.js --env production
pm2 save

# Health check
log_info "Running health check..."
sleep 5
if curl -sf http://localhost:3101/api/health > /dev/null 2>&1; then
    log_success "Health check passed!"
else
    log_warn "Health check pending - check logs with: pm2 logs forex-backend"
fi

echo ""
log_success "🎉 Restore complete!"
echo ""
pm2 status
