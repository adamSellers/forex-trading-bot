#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
# Replace with your Raspberry Pi's user and IP address/hostname.
PI_USER="adam"
PI_HOST="img.oakroad"
PI_PASSWORD="1shanks1!" # <-- Add your password here

# The destination directory on your Raspberry Pi.
# This should match the root of your project.
REMOTE_DIR="/opt/crypto-trading-bot"
# --- End Configuration ---

echo "🚀 Starting deployment to ${PI_HOST}..."

# 1. Build the frontend for production
# This creates an optimized build in the `frontend/dist` directory.
echo "📦 Building React frontend..."
npm run build:frontend

# 2. Sync files to the Raspberry Pi using rsync
# rsync is efficient and only transfers changed files.
# We exclude files and directories that are not needed in production.
echo "Syncing files to ${PI_HOST}..."
# The -e option tells rsync which command to use for its remote shell.
# We wrap the standard ssh command with sshpass.
rsync -avz --delete -e "sshpass -p '${PI_PASSWORD}' ssh" \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'frontend/node_modules' \
    --exclude 'frontend/src' \
    --exclude 'frontend/public' \
    --exclude 'backend/node_modules' \
    --exclude '.env' \
    --exclude '*.log' \
    ./ "${PI_USER}@${PI_HOST}:${REMOTE_DIR}"

echo "✅ Files synced successfully."

# 3. Execute remote commands on the Raspberry Pi via SSH
# - Install/update backend production dependencies.
# - Reload the application using PM2 for a zero-downtime update.
echo "⚙️  Installing dependencies and restarting server on Pi..."
sshpass -p "${PI_PASSWORD}" ssh "${PI_USER}@${PI_HOST}" "
    set -e
    cd ${REMOTE_DIR}
    echo 'Installing backend dependencies...'
    npm install --prefix backend --production --omit=dev
    echo 'Reloading application with PM2...'
    pm2 reload ecosystem.config.js --env production
    pm2 save
"

echo "🎉 Deployment complete! Your application is live."