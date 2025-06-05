#!/bin/bash
set -e

PROJECT_DIR="/opt/crypto-trading-bot"
echo "🚀 Starting deployment..."

cd $PROJECT_DIR

# Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# Install/update backend dependencies
echo "📦 Installing backend dependencies..."
cd backend
npm ci --production

# Build frontend
echo "🏗️ Building frontend..."
cd ../frontend
npm ci
npm run build

# Database migrations
echo "🗄️ Running database migrations..."
cd ../backend
npm run db:migrate

# Restart services
echo "🔄 Restarting services..."
pm2 restart crypto-trading-bot

echo "✅ Deployment completed!"