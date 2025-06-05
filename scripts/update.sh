# ===================================================
# scripts/update.sh - Quick update without full reinstall
# ===================================================
#!/bin/bash
set -e

PROD_HOST="img.oakroad"
PROD_USER="adam"
PROD_PATH="/opt/crypto-trading-bot"

echo "🔄 Quick update deployment..."

# Pre-checks
echo "🔍 Running pre-update checks..."
./scripts/deploy-check.sh

# Create backup
echo "📦 Creating backup..."
ssh $PROD_USER@$PROD_HOST "cd $PROD_PATH && ./scripts/backup.sh"

# Sync code changes
echo "📤 Syncing code changes..."
rsync -avz --exclude 'node_modules' --exclude 'logs' --exclude '.git' \
    --exclude 'backend/data' --exclude '.env*' \
    ./ $PROD_USER@$PROD_HOST:$PROD_PATH/

# Update and restart
ssh $PROD_USER@$PROD_HOST << EOF
    cd $PROD_PATH
    
    echo "📦 Updating dependencies..."
    npm run install:backend
    npm run install:frontend
    
    echo "🏗️ Building frontend..."
    npm run build:frontend
    
    echo "🗄️ Running migrations..."
    npm run db:migrate
    
    echo "🔄 Restarting services..."
    pm2 restart img-backend
    
    echo "⏳ Waiting for service..."
    sleep 5
    
    echo "🩺 Health check..."
    curl -f http://localhost:3001/api/health || exit 1
    
    echo "✅ Update completed!"
EOF

echo "🎉 Quick update completed successfully!"