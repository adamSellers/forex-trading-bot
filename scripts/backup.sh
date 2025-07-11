#!/bin/bash

# --- Configuration ---
# CONSISTENT & EXTERNAL BACKUP PATH
BACKUP_DIR="$HOME/crypto-trading-bot-backups" # Use user's home directory for backups
PROJECT_DIR="/opt/crypto-trading-bot"         # Keep for source path
APP_NAME="crypto-trend-bot"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="daily_backup_${TIMESTAMP}.tar.gz" # Differentiate daily from deploy backups

echo "📦 Creating backup..."

mkdir -p $BACKUP_DIR

# --- Graceful Stop/Start for Standalone Execution (Cron Job) ---
was_running=false
if pm2 list | grep -q "$APP_NAME.*online"; then
    was_running=true
fi

# Stop the service to ensure a consistent state for backup
if [ "$was_running" = true ]; then
    echo "   └─ Stopping PM2 service '$APP_NAME' for consistent backup..."
    pm2 stop "$APP_NAME" --silent
    sleep 2 # Give it a moment to stop
fi

echo "   └─ Creating full project archive..."

# Create a comprehensive tarball backup
# -czf: create, gzip, file
# --exclude: patterns to ignore
# -C: change to this directory before adding files
tar -czf "$BACKUP_DIR/$BACKUP_FILE" \
    --exclude='node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='backend/node_modules' \
    --exclude='*.log' \
    --exclude='backend/logs/*' \
    --exclude='backend/backups/*' \
    -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")"

echo "✅ Backup created: $BACKUP_DIR/$BACKUP_FILE"

# Clean old backups (keep last 7)
echo "   └─ Cleaning old backups (keeping last 7)..."
ls -tp "$BACKUP_DIR" | grep -v '/$' | tail -n +8 | xargs -I {} rm -f -- "$BACKUP_DIR/{}"

# --- Restart the service if it was running before ---
if [ "$was_running" = true ]; then
    echo "   └─ Restarting PM2 service '$APP_NAME'..."
    pm2 start "$APP_NAME" --env production
fi

echo "$(date): Backup completed" >> "$BACKUP_DIR/backup.log"