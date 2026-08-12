#!/bin/bash
# Safe unattended update path. Live trading must be paused, tracked local work
# is preserved, lockfiles are honored, and tests/builds pass before cutover.

set -Eeuo pipefail

APP_NAME="${FOREX_APP_NAME:-forex-backend}"
PROJECT_DIR="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
BRANCH="${FOREX_BRANCH:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

cd "$PROJECT_DIR" || fail "Project directory not found: $PROJECT_DIR"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    fail "Tracked working tree changes detected; refusing to overwrite them"
fi

if [ "${ALLOW_LIVE_DEPLOY:-0}" != "1" ]; then
    health=$(curl -sf http://localhost:3101/api/health 2>/dev/null || true)
    if [ -n "$health" ]; then
        trading_enabled=$(printf '%s' "$health" | python3 -c \
            'import json,sys; data=json.load(sys.stdin); print(str(bool((data.get("config") or {}).get("enableTrading"))).lower())' \
            2>/dev/null || echo unknown)
        [ "$trading_enabled" != "true" ] || fail "Pause live trading before update"
    fi
fi

log "Creating verified pre-update backup"
FOREX_BACKUP_DIR="${FOREX_BACKUP_DIR:-$HOME/forex-trading-bot-backups}" \
    FOREX_BACKUP_REQUIRE_RUN=1 \
    "$SCRIPT_DIR/backup.sh"

before_hash=$(git rev-parse HEAD)
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH"
after_hash=$(git rev-parse HEAD)

if [ "$before_hash" = "$after_hash" ]; then
    log "Already up to date"
    exit 0
fi

changed_files=$(git diff --name-only "$before_hash" "$after_hash")
backend_changed=false
frontend_changed=false
printf '%s\n' "$changed_files" | grep -qE '^(backend/|shared/|package)' && backend_changed=true || true
printf '%s\n' "$changed_files" | grep -qE '^(frontend/|shared/|package)' && frontend_changed=true || true

if [ "$backend_changed" = true ]; then
    log "Installing backend lockfile and running tests"
    (cd backend && npm ci && npm test -- --runInBand)
fi

if [ "$frontend_changed" = true ]; then
    log "Installing frontend lockfile and building"
    (cd frontend && npm ci && \
        NODE_OPTIONS="--max-old-space-size=2048" \
        NODE_ENV=production GENERATE_SOURCEMAP=false npm run build)
fi

if [ "$backend_changed" = true ]; then
    (cd backend && npm prune --omit=dev)
fi

log "Stopping service for migration cutover"
pm2 stop "$APP_NAME" --silent 2>/dev/null || true
(cd backend && NODE_ENV=production npm run db:migrate)

log "Reloading application"
pm2 reload ecosystem.config.js --env production 2>/dev/null || \
    pm2 start ecosystem.config.js --env production
pm2 save

for _attempt in $(seq 1 12); do
    curl -sf http://localhost:3101/api/health >/dev/null 2>&1 && break
    sleep 5
done
curl -sf http://localhost:3101/api/health >/dev/null 2>&1 || \
    fail "API did not become healthy after update"
"$SCRIPT_DIR/health-check.sh" || fail "Comprehensive health check failed"

log "Update complete: ${before_hash:0:7} -> ${after_hash:0:7}"
