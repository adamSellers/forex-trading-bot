#!/bin/bash

# --- Configuration ---
PROJECT_DIR="/opt/crypto-trading-bot"
BACKUP_DIR="${PROJECT_DIR}/backend/backups"
DB_PATH="${PROJECT_DIR}/backend/data/trading.db"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="backup_${TIMESTAMP}.tar.gz"

echo "📦 Creating backup..."

mkdir -p $BACKUP_DIR

# Stop the service to ensure a consistent state for backup
echo "   └─ Stopping PM2 service for consistent backup..."
pm2 stop crypto-trend-bot --silent || true
sleep 2 # Give it a moment to stop

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
ls -tp "$BACKUP_DIR" | grep -v '/$' | tail -n +8 | xargs -I {} rm -- "$BACKUP_DIR/{}"

echo "$(date): Backup completed" >> "$BACKUP_DIR/backup.log"