#!/bin/bash
BACKUP_DIR="/opt/crypto-trading-bot/backend/backups"
DB_PATH="/opt/crypto-trading-bot/data/trading.db"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

echo "📦 Creating backup..."

mkdir -p $BACKUP_DIR

if [ -f "$DB_PATH" ]; then
    sqlite3 $DB_PATH ".backup $BACKUP_DIR/trading_backup_$TIMESTAMP.db"
    gzip "$BACKUP_DIR/trading_backup_$TIMESTAMP.db"
    echo "✅ Backup created: trading_backup_$TIMESTAMP.db.gz"
    
    # Clean old backups (keep last 30 days)
    find $BACKUP_DIR -name "*.gz" -mtime +30 -delete
    
    echo "$(date): Backup completed" >> $BACKUP_DIR/backup.log
else
    echo "⚠️ Database file not found: $DB_PATH"
    echo "🔍 Checking for database files..."
    find /opt/crypto-trading-bot -name "*.db" -type f 2>/dev/null | head -5
    echo "💡 Run 'npm run db:migrate' if database doesn't exist"
fi