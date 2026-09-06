#!/bin/bash
# Internal runner from a pinned archive. Build artifacts stay separate until
# preparation passes. Cutover failures retain evidence for explicit recovery.
set -Eeuo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="${FOREX_PROJECT_DIR:?Use deploy.sh or update.sh}"
REVISION="${FOREX_DEPLOY_REVISION:?Pinned release required}"
EXPECTED_HEAD="${FOREX_DEPLOY_EXPECTED_HEAD:?Original revision required}"
APP_NAME="${FOREX_APP_NAME:-forex-backend}"
API_URL="${FOREX_API_URL:-http://localhost:3101/api}"
BACKUP_DIR="${FOREX_BACKUP_DIR:-$HOME/forex-trading-bot-backups}"
source "$SCRIPT_DIR/load-node-runtime.sh"
source "$SCRIPT_DIR/load-maintenance-api.sh"
source "$SCRIPT_DIR/deployment-lock.sh"
forex_acquire_deployment_lock "$BACKUP_DIR/.backup.lock"
log() { printf '%s\n' "$*"; }
fail() { log "Deployment stopped: $*" >&2; exit 1; }
was_enabled=false
paused_by_deploy=false
cutover=false
completed=false

json_enabled() {
    python3 -c 'import json,sys; value=json.load(sys.stdin).get("config",{}).get("enableTrading"); sys.exit("Trading state is unavailable") if type(value) is not bool else print(str(value).lower())'
}
read_enabled() { forex_api_curl "$API_URL/health" | json_enabled; }
resume_previous_state() {
    local enabled
    if [ "$was_enabled" = true ] && [ "$paused_by_deploy" = true ]; then
        # A lost HTTP reply can follow a successful durable state change.
        forex_api_curl -X POST "$API_URL/trading/start" >/dev/null || true
        if ! enabled=$(read_enabled); then
            forex_api_curl -X POST "$API_URL/trading/stop" >/dev/null 2>&1 || true
            enabled=$(read_enabled) || {
                log "Cannot verify the trading state after restoration; inspect the API and broker before further maintenance." >&2
                return 2
            }
            if [ "$enabled" != false ]; then
                log "Could not verify the fallback entry pause; inspect the API and broker." >&2
                return 2
            fi
        fi
        if [ "$enabled" = true ]; then
            paused_by_deploy=false
            log "Previous trading state restored: enabled."
        else
            # Never override cooldowns, unresolved state or failed persistence.
            log "Entries remain paused: live readiness did not allow automatic restoration. Position management remains running." >&2
            return 1
        fi
    fi
}
cleanup() {
    local status=$?
    trap - EXIT
    if [ "$status" -ne 0 ]; then
        if [ "$cutover" = true ]; then
            forex_api_curl -X POST "$API_URL/trading/stop" >/dev/null 2>&1 || true
            log "Deployment failed during cutover. Cutover began with a verified durable pause; the current process/trading state needs inspection. Preserve the backup and recovery files before recovery." >&2
        elif [ "$completed" = false ]; then
            resume_previous_state || true
            log "Preparation failed; the deployed source and dependencies were not replaced." >&2
        fi
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

check_checkout() {
    [ "$(git -C "$PROJECT_DIR" rev-parse HEAD)" = "$EXPECTED_HEAD" ] || fail "Production revision changed during preparation."
    [ -z "$(git -C "$PROJECT_DIR" status --porcelain --untracked-files=no)" ] || fail "Production source changed during preparation."
}
check_checkout
# Replace the old token-gated release using its existing saved credential only
# if it returns 401. New installations and the new release need no login.
export FOREX_DEPLOY_LEGACY_ACCESS=1
was_enabled=$(read_enabled) || fail "Cannot read the current trading state."
if [ "$was_enabled" = true ]; then
    # Mark the obligation before the request, which may succeed despite a lost reply.
    paused_by_deploy=true
    forex_api_curl -X POST "$API_URL/trading/stop" >/dev/null || fail "Could not confirm the entry pause."
fi
forex_require_paused_flat_running || fail "Waiting for a flat broker account and resolved orders. Management has been left running."

# Artifacts can be moved into place only on the same filesystem.
python3 -c 'import os,sys; sys.exit(0 if os.stat(sys.argv[1]).st_dev == os.stat(sys.argv[2]).st_dev else "Deployment staging and production must share a filesystem")' "$STAGE_DIR" "$PROJECT_DIR"
log "Preparing release ${REVISION:0:7}: installing dependencies, testing and building..."
(
    cd "$STAGE_DIR/backend"
    npm ci --include=dev
    env -u OANDA_API_KEY -u OANDA_ACCOUNT_ID -u OANDA_ENVIRONMENT \
        -u FOREX_OPERATOR_TOKEN -u FOREX_PROJECT_DIR -u FOREX_DEPLOY_LEGACY_ACCESS \
        -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
        -u EMAIL_PASS -u SMTP_PASSWORD \
        NODE_ENV=test DB_PATH="$STAGE_DIR/backend/data/deployment-test.db" \
        ENABLE_S3_ANALYTICS=false npm test -- --runInBand
)
(cd "$STAGE_DIR/frontend" && npm ci --include=dev && NODE_OPTIONS="--max-old-space-size=2048" NODE_ENV=production npm run build)
(cd "$STAGE_DIR/backend" && npm prune --omit=dev)
[ -d "$STAGE_DIR/backend/node_modules" ] && [ -f "$STAGE_DIR/frontend/dist/index.html" ] || fail "Prepared release artifacts are incomplete."

log "Backing up the paused installation..."
FOREX_BACKUP_REQUIRE_RUN=1 bash "$SCRIPT_DIR/backup.sh"
check_checkout
forex_require_paused_flat_running || fail "Trading state changed before cutover."
log "Installing release ${REVISION:0:7}..."
cutover=true
touch "$STAGE_DIR/.cutover-started"
pm2 stop "$APP_NAME" --silent || fail "Could not stop the existing process."
git -C "$PROJECT_DIR" merge --ff-only "$REVISION"
# Old artifacts remain in this private stage until the command completes. A
# failed same-revision retry always repeats preparation; HEAD is not a receipt.
if [ -d "$PROJECT_DIR/backend/node_modules" ]; then mv "$PROJECT_DIR/backend/node_modules" "$STAGE_DIR/previous-backend-modules"; fi
mv "$STAGE_DIR/backend/node_modules" "$PROJECT_DIR/backend/node_modules"
if [ -d "$PROJECT_DIR/frontend/dist" ]; then mv "$PROJECT_DIR/frontend/dist" "$STAGE_DIR/previous-frontend-dist"; fi
mv "$STAGE_DIR/frontend/dist" "$PROJECT_DIR/frontend/dist"
(cd "$PROJECT_DIR/backend" && DB_PATH="$PROJECT_DIR/backend/data/trading.db" NODE_ENV=production npm run db:migrate)
unset FOREX_DEPLOY_LEGACY_ACCESS FOREX_OPERATOR_TOKEN
(cd "$PROJECT_DIR" && exec 9>&- && unset FOREX_DEPLOY_LOCK_FD && pm2 start ecosystem.config.js --env production)
pm2 save

healthy=false
for _attempt in $(seq 1 12); do
    if bash "$SCRIPT_DIR/health-check.sh" > "$STAGE_DIR/health-check.log" 2>&1; then healthy=true; break; fi
    sleep 5
done
if [ "$healthy" != true ]; then cat "$STAGE_DIR/health-check.log" >&2; fail "The new release did not pass operational health."; fi
[ "$(read_enabled)" = false ] || fail "The new release did not stay paused during verification."
completed=true
cutover=false
rm -f "$STAGE_DIR/.cutover-started"
resume_status=0
resume_previous_state || resume_status=$?
if [ "$resume_status" -eq 1 ]; then
    log "Release ${REVISION:0:7} is deployed and healthy; entries remain paused by readiness."
    exit 2
elif [ "$resume_status" -ne 0 ]; then
    log "Release ${REVISION:0:7} passed health, but its final trading state could not be confirmed." >&2
    exit 1
fi
log "Deployment complete: ${REVISION:0:7}. Dashboard: http://fx.oakroad"
if [ "$was_enabled" = false ]; then log "Previous trading state preserved: paused."; fi
