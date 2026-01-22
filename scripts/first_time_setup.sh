#!/bin/bash
# =====================================================
# Forex Trading Bot - First Time Setup (Mac Mini)
# Run this ONCE to set up the forex bot alongside crypto bot
# =====================================================

set -e

# --- Config ---
APP_NAME="forex-backend"
PROJECT_DIR="/opt/forex-trading-bot"
PROJECT_USER=$(whoami)
PROJECT_GROUP=$(id -gn)  # Get primary group (works on macOS and Linux)
REPO_URL="git@github.com:adamSellers/forex-trading-bot.git"
BRANCH="mac-mini"

# --- Colors ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log_step() { echo -e "${BLUE}🔧 $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; exit 1; }


echo ""
echo "═══════════════════════════════════════════════════════════"
echo "       🚀 FOREX TRADING BOT - FIRST TIME SETUP"
echo "           (Mac Mini)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# --- Validation ---
if [[ $EUID -eq 0 ]]; then
    log_error "Don't run as root. Use your normal user account."
fi

if [ -d "$PROJECT_DIR" ]; then
    log_warn "Directory $PROJECT_DIR already exists!"
    read -p "Remove and start fresh? (y/N): " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        pm2 delete $APP_NAME --silent 2>/dev/null || true
        sudo rm -rf "$PROJECT_DIR"
    else
        log_error "Aborting. Use deploy.sh for updates instead."
    fi
fi

# --- 1. Clone Repository ---
log_step "Cloning forex-trading-bot repository..."
sudo mkdir -p "$PROJECT_DIR"
sudo chown $PROJECT_USER:$PROJECT_GROUP "$PROJECT_DIR"
git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
cd "$PROJECT_DIR"
log_success "Repository cloned"

# --- 2. Install Dependencies ---
log_step "Installing backend dependencies..."
cd backend
npm install --omit=dev
cd ..

if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then
    log_step "Installing frontend dependencies..."
    cd frontend
    npm install
    cd ..
fi
log_success "Dependencies installed"

# --- 3. Build Frontend ---
if [ -d "frontend" ]; then
    log_step "Building frontend (this may take a few minutes on Mac Mini)..."
    cd frontend
    NODE_OPTIONS="--max-old-space-size=2048" NODE_ENV=production npm run build
    cd ..
    
    if [ -d "frontend/dist" ]; then
        log_success "Frontend built successfully"
    else
        log_warn "Frontend build may have issues - check logs"
    fi
fi

# --- 4. Setup Database ---
log_step "Setting up database..."
cd backend
mkdir -p data
mkdir -p logs
npm run db:migrate
cd ..
log_success "Database initialized"

# --- 5. Setup Secrets ---
log_step "Setting up encrypted secrets..."
chmod +x scripts/*.sh
./scripts/setup-secrets.sh

# --- 6. Register with PM2 ---
log_step "Registering with PM2..."
pm2 start ecosystem.config.js --env production
pm2 save
log_success "PM2 configured"

# --- 7. Health Check ---
log_step "Running health check..."
sleep 5
max_attempts=12
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if curl -f -s http://localhost:3101/api/health > /dev/null 2>&1; then
        break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 5
done
echo ""

if [ $attempt -lt $max_attempts ]; then
    log_success "Health check passed!"
    
    # Show status
    echo ""
    curl -s http://localhost:3101/api/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3101/api/health
else
    log_warn "Health check timed out - checking logs..."
    pm2 logs forex-backend --lines 30 --nostream
fi

# --- Done! ---
echo ""
echo "═══════════════════════════════════════════════════════════"
log_success "🎉 FOREX BOT SETUP COMPLETE!"
echo ""
echo "Services:"
echo "  Backend:  http://localhost:3101"
echo "  Frontend: http://localhost:3100 (or served by backend)"
echo ""
echo "Quick Commands:"
echo "  pm2 status                    - Check both bots"
echo "  pm2 logs forex-backend        - View forex logs"
echo "  pm2 logs crypto-backend       - View crypto logs"
echo "  pm2 restart forex-backend     - Restart forex bot"
echo ""
echo "Dashboard:"
echo "  http://localhost:3101        - Forex Bot (or http://<mac-mini-ip>:3101)"
echo "  http://localhost:3001        - Crypto Bot (or http://<mac-mini-ip>:3001)"
echo ""
echo "Next Steps:"
echo "  1. Open dashboard and verify connection"
echo "  2. Check Settings → all config loaded correctly"
echo "  3. Trading is ENABLED - bot is live!"
echo "═══════════════════════════════════════════════════════════"