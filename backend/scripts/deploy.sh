#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Deployment Configuration ---
# Your Raspberry Pi's user, IP address/hostname, and password.
PI_USER="adam"
PI_HOST="img.oakroad"
PI_PASSWORD="1shanks1!"

# The destination directory on your Raspberry Pi.
REMOTE_DIR="/opt/crypto-trading-bot"
# --- End Configuration ---

echo "🚀 Starting deployment to ${PI_HOST}..."

# 1. Run pre-deployment checks to ensure a safe deployment
echo "🩺 Running pre-deployment checks..."
if [ -f "./scripts/deploy-check.sh" ]; then
    ./scripts/deploy-check.sh
else
    echo "⚠️ Warning: deploy-check.sh not found. Skipping checks."
fi

# 2. Build the frontend for production
echo "📦 Building React frontend..."
npm run build:frontend

# 3. Sync project files to the Raspberry Pi using rsync
echo "Syncing files to ${PI_HOST}..."
rsync -avz --delete -e "sshpass -p '${PI_PASSWORD}' ssh" \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'frontend/node_modules' \
    --exclude 'frontend/src' \
    --exclude 'frontend/public' \
    --exclude 'backend/data' \
    --exclude 'backend/node_modules' \
    --exclude '.env' \
    --exclude '*.log' \
    ./ "${PI_USER}@${PI_HOST}:${REMOTE_DIR}"

# 4. Execute remote commands on the Raspberry Pi via SSH
echo "⚙️  Installing dependencies, migrating DB, and restarting server on Pi..."
sshpass -p "${PI_PASSWORD}" ssh "${PI_USER}@${PI_HOST}" "
    set -e
    cd ${REMOTE_DIR}
    echo 'Installing backend dependencies...'
    npm install --prefix backend --production --omit=dev
    echo '🗄️ Running database migrations...'
    npm run db:migrate
    echo 'Reloading application with PM2...'
    pm2 reload ecosystem.config.js --env production
    pm2 save
"

echo "🎉 Deployment complete! Your application is live."