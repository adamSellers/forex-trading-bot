# ===================================================
# scripts/rollback.sh - Emergency rollback
# ===================================================
#!/bin/bash
set -e

PROD_HOST="img.oakroad"
PROD_USER="adam"
PROD_PATH="/opt/crypto-trading-bot"

echo "🔄 Rolling back to previous deployment..."

ssh $PROD_USER@$PROD_HOST << 'EOF'
    cd /opt/crypto-trading-bot
    
    # Find latest backup
    latest_backup=$(ls -t backend/backups/*.gz 2>/dev/null | head -1)
    
    if [ -z "$latest_backup" ]; then
        echo "❌ No backup found for rollback"
        exit 1
    fi
    
    echo "📦 Restoring from backup: $latest_backup"
    
    # Stop services
    pm2 stop img-backend
    
    # Restore database
    gunzip -c "$latest_backup" > /tmp/restore.db
    cp /tmp/restore.db backend/data/trading.db
    rm /tmp/restore.db
    
    # Restart services
    pm2 start img-backend
    
    # Wait and test
    sleep 5
    if curl -f -s http://localhost:3001/api/health > /dev/null; then
        echo "✅ Rollback completed successfully"
    else
        echo "❌ Rollback may have failed - check logs"
        exit 1
    fi
EOF

echo "✅ Rollback completed!"