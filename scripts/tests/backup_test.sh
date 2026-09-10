#!/bin/bash

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_SCRIPT="$REPO_ROOT/scripts/backup.sh"
TEST_ROOT=$(mktemp -d)
STUB_BIN="$TEST_ROOT/bin"
PROJECT_DIR="$TEST_ROOT/project"
BACKUP_DIR="$TEST_ROOT/backups"
CALL_LOG="$TEST_ROOT/calls.log"

cleanup() {
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_file() {
    [ -f "$1" ] || fail "expected file: $1"
}

assert_no_file() {
    [ ! -e "$1" ] || fail "unexpected file: $1"
}

assert_contains() {
    grep -Fq -- "$2" "$1" || fail "expected '$2' in $1"
}

mkdir -p "$STUB_BIN"

cat > "$STUB_BIN/flock" <<'EOF'
#!/bin/bash
[ "${STUB_FLOCK_FAIL:-0}" != 1 ] || exit 1
# Exercise real descriptor inheritance and contention even on development
# machines without the Linux flock executable.
python3 - "$@" <<'PY'
import fcntl
import sys
try:
    fcntl.flock(int(sys.argv[-1]), fcntl.LOCK_EX | fcntl.LOCK_NB)
except (OSError, ValueError):
    sys.exit(1)
PY
EOF

cat > "$STUB_BIN/timeout" <<'EOF'
#!/bin/bash
while [ "$#" -gt 0 ]; do
    case "$1" in
        --signal=*|--kill-after=*) shift ;;
        *) break ;;
    esac
done
shift
exec "$@"
EOF

cat > "$STUB_BIN/pm2" <<'EOF'
#!/bin/bash
echo "pm2 $*" >> "$CALL_LOG"
case "${1:-}" in
    pid) echo "${STUB_PM2_PID:-1234}" ;;
esac
EOF

cat > "$STUB_BIN/curl" <<'EOF'
#!/bin/bash
echo "curl $*" >> "$CALL_LOG"
case "$*" in
    *'/summary'*)
        header=$(cat)
        [[ "$header" == *'Authorization: Bearer '* ]] || exit 99
        ;;
    *) [[ "$*" != *'--config -'* && "$*" != *'Authorization:'* ]] || exit 99 ;;
esac
if [ "${STUB_ACTUAL_ACTIVATION:-0}" = 1 ]; then
    case "$*" in
        *'/health'*) exec "$MAINTENANCE_TEST_NODE" "$MAINTENANCE_TEST_API" health ;;
        *'/trading/stop'*) exec "$MAINTENANCE_TEST_NODE" "$MAINTENANCE_TEST_API" stop ;;
        *'/trading/start'*) exec "$MAINTENANCE_TEST_NODE" "$MAINTENANCE_TEST_API" start ;;
    esac
fi
case "$*" in
    *'/summary'*) echo '{"account":{"openTradeCount":"0","pendingOrderCount":"0"}}' ;;
    *'/engine/stats'*)
        [ "${STUB_ENGINE_STATS_FAIL:-0}" != 1 ] || exit 22
        if [ -n "${STUB_ENGINE_STATS:-}" ]; then printf '%s' "$STUB_ENGINE_STATS"; else echo '{"isProcessingQueue":false,"queueLength":0}'; fi
        ;;
    *'/trading/stop'*) printf '{"enableTrading":false}' > "$FOREX_PROJECT_DIR/backend/data/trading_config.json"; echo '{"success":true}' ;;
    *'/trading/start'*) echo '{"success":true}' ;;
    *'/account'*) echo "{\"openTrades\":${STUB_OPEN_TRADES:-0}}" ;;
    *'/health'*) echo '{"status":"ok","config":{"enableTrading":true}}' ;;
    *) exit 1 ;;
esac
EOF

cat > "$STUB_BIN/tar" <<'EOF'
#!/bin/bash
echo "tar $*" >> "$CALL_LOG"
[ "${1:-}" = -czf ] || exit 2
: > "$2"
EOF

cat > "$STUB_BIN/gzip" <<'EOF'
#!/bin/bash
echo "gzip $*" >> "$CALL_LOG"
exit 0
EOF

cat > "$STUB_BIN/sqlite3" <<'EOF'
#!/bin/bash
echo "sqlite3 $*" >> "$CALL_LOG"
last=''
for argument in "$@"; do
    last="$argument"
done
case "$last" in
    ".backup "*)
        target=$(printf '%s\n' "$last" | sed -n "s/^\.backup '\(.*\)'$/\1/p")
        [ -n "$target" ] || exit 2
        : > "$target"
        [ "${STUB_SQLITE_BACKUP_FAIL:-0}" != 1 ] || exit 1
        printf 'snapshot\n' > "$target"
        ;;
    'PRAGMA quick_check;')
        if [ "${STUB_SQLITE_INTEGRITY_FAIL:-0}" = 1 ]; then
            echo corrupt
        else
            echo ok
        fi
        ;;
    *) exit 2 ;;
esac
EOF

cat > "$STUB_BIN/sleep" <<'EOF'
#!/bin/bash
exit 0
EOF

chmod +x "$STUB_BIN"/*

export PATH="$STUB_BIN:$PATH"
export CALL_LOG STUB_PM2_PID=1234
export FOREX_NODE_RUNTIME_LOADED=1
unset FOREX_OPERATOR_TOKEN
export OANDA_API_KEY=test-broker-token OANDA_ACCOUNT_ID=001-002-003 OANDA_ENVIRONMENT=practice
export FOREX_PROJECT_DIR="$PROJECT_DIR"
export FOREX_BACKUP_DIR="$BACKUP_DIR"
export FOREX_BACKUP_RETENTION=3
export FOREX_BACKUP_TIMEOUT_SECONDS=60
export FOREX_BACKUP_TIMESTAMP=20990101_000000
export MAINTENANCE_TEST_NODE="$(command -v node)"
export MAINTENANCE_TEST_API="$REPO_ROOT/scripts/tests/maintenance_api_fixture.cjs"
export MAINTENANCE_TEST_PROJECT="$PROJECT_DIR"

reset_case() {
    rm -rf "$PROJECT_DIR" "$BACKUP_DIR"
    mkdir -p "$PROJECT_DIR/backend/data" "$BACKUP_DIR"
    python3 - "$PROJECT_DIR/backend/data/trading.db" <<'PY'
import sqlite3, sys
connection = sqlite3.connect(sys.argv[1])
connection.executescript("CREATE TABLE broker_order_intents(status TEXT); CREATE TABLE broker_position_quarantines(status TEXT);")
connection.close()
PY
    printf '{"enableTrading":true}' > "$PROJECT_DIR/backend/data/trading_config.json"
    : > "$CALL_LOG"
    unset STUB_FLOCK_FAIL STUB_OPEN_TRADES STUB_SQLITE_BACKUP_FAIL STUB_SQLITE_INTEGRITY_FAIL
    unset STUB_ENGINE_STATS STUB_ENGINE_STATS_FAIL
    unset STUB_ACTUAL_ACTIVATION STUB_LAST_LOSS_AT STUB_RISK_CLOCK_MS
}

test_backup_restores_enabled_intent_without_clearing_loss_cooldown() {
    reset_case
    export STUB_ACTUAL_ACTIVATION=1
    export STUB_LAST_LOSS_AT="$(python3 -c 'import time; print(int(time.time()*1000)-60000)')"

    bash "$BACKUP_SCRIPT" >/dev/null

    assert_file "$BACKUP_DIR/trading_20990101_000000.db"
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db.partial"
    "$MAINTENANCE_TEST_NODE" "$MAINTENANCE_TEST_API" health | python3 -c \
        'import json,sys; assert json.load(sys.stdin)["config"]["enableTrading"] is True'
    "$MAINTENANCE_TEST_NODE" "$MAINTENANCE_TEST_API" readiness | python3 -c \
        'import json,sys,os; r=json.load(sys.stdin); assert r["status"]=="COOLDOWN" and r["passed"] is False; assert r["entryRisk"]["entryAllowed"] is False; assert r["entryRisk"]["cooldownUntil"]==int(os.environ["STUB_LAST_LOSS_AT"])+86400000'
    export STUB_RISK_CLOCK_MS="$((STUB_LAST_LOSS_AT + 86400000))"
    "$MAINTENANCE_TEST_NODE" "$MAINTENANCE_TEST_API" readiness | python3 -c \
        'import json,sys; r=json.load(sys.stdin); assert r["passed"] is True and r["entryRisk"]["consecutiveLosses"]==0'
    "$MAINTENANCE_TEST_NODE" "$MAINTENANCE_TEST_API" health | python3 -c \
        'import json,sys; assert json.load(sys.stdin)["config"]["enableTrading"] is True'
}

test_backup_preserves_operator_pause_during_and_after_cooldown() {
    reset_case
    export STUB_ACTUAL_ACTIVATION=1
    export STUB_LAST_LOSS_AT="$(python3 -c 'import time; print(int(time.time()*1000)-60000)')"
    printf '{"enableTrading":false}' > "$PROJECT_DIR/backend/data/trading_config.json"

    bash "$BACKUP_SCRIPT" >/dev/null

    assert_file "$BACKUP_DIR/trading_20990101_000000.db"
    if grep -Fq '/trading/start' "$CALL_LOG"; then fail "backup overrode an operator pause"; fi
    export STUB_RISK_CLOCK_MS="$((STUB_LAST_LOSS_AT + 86400000))"
    "$MAINTENANCE_TEST_NODE" "$MAINTENANCE_TEST_API" health | python3 -c \
        'import json,sys; assert json.load(sys.stdin)["config"]["enableTrading"] is False'
}

test_successful_safe_backup() {
    local index
    reset_case
    for index in 1 2 3 4 5; do
        printf 'old\n' > "$BACKUP_DIR/trading_2026010${index}_000000.db"
        printf 'old\n' > "$BACKUP_DIR/forex_backup_2026010${index}_000000.tar.gz"
    done

    bash "$BACKUP_SCRIPT" >/dev/null

    assert_file "$BACKUP_DIR/trading_20990101_000000.db"
    assert_file "$BACKUP_DIR/forex_backup_20990101_000000.tar.gz"
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db.partial"
    [ "$(find "$BACKUP_DIR" -maxdepth 1 -name 'trading_*.db' | wc -l | tr -d ' ')" -eq 3 ] || \
        fail "database retention did not keep exactly three snapshots"
    [ "$(find "$BACKUP_DIR" -maxdepth 1 -name 'forex_backup_*.tar.gz' | wc -l | tr -d ' ')" -eq 3 ] || \
        fail "archive retention did not keep exactly three files"
    assert_contains "$CALL_LOG" "-X POST http://localhost:3101/api/trading/stop"
    assert_contains "$CALL_LOG" "pm2 stop forex-backend --silent"
    assert_contains "$CALL_LOG" "pm2 start forex-backend --env production"
    assert_contains "$CALL_LOG" "-X POST http://localhost:3101/api/trading/start"
}

test_lock_collision_skips_without_output() {
    reset_case
    export STUB_FLOCK_FAIL=1
    bash "$BACKUP_SCRIPT" >/dev/null
    assert_no_file "$BACKUP_DIR/forex_backup_20990101_000000.tar.gz"
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db"
}

test_required_lock_collision_fails_deploy_gate() {
    reset_case
    export STUB_FLOCK_FAIL=1 FOREX_BACKUP_REQUIRE_RUN=1
    if bash "$BACKUP_SCRIPT" >/dev/null 2>&1; then
        fail "required backup unexpectedly ignored lock collision"
    fi
    assert_no_file "$BACKUP_DIR/forex_backup_20990101_000000.tar.gz"
    unset FOREX_BACKUP_REQUIRE_RUN
}

test_failed_snapshot_cleans_partial_and_restores_runtime() {
    reset_case
    export STUB_SQLITE_BACKUP_FAIL=1
    if bash "$BACKUP_SCRIPT" >/dev/null 2>&1; then
        fail "backup unexpectedly succeeded when sqlite3 failed"
    fi
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db"
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db.partial"
    assert_contains "$CALL_LOG" "pm2 start forex-backend --env production"
    assert_contains "$CALL_LOG" "-X POST http://localhost:3101/api/trading/start"
}

test_failed_integrity_check_does_not_publish_snapshot() {
    reset_case
    export STUB_SQLITE_INTEGRITY_FAIL=1
    if bash "$BACKUP_SCRIPT" >/dev/null 2>&1; then
        fail "backup unexpectedly published a corrupt snapshot"
    fi
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db"
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db.partial"
    assert_contains "$CALL_LOG" "pm2 start forex-backend --env production"
    assert_contains "$CALL_LOG" "-X POST http://localhost:3101/api/trading/start"
}

test_open_trade_fails_closed_without_stopping_service() {
    reset_case
    export STUB_OPEN_TRADES=1
    if bash "$BACKUP_SCRIPT" >/dev/null 2>&1; then
        fail "backup unexpectedly snapshotted a database with an open trade"
    fi
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db"
    if grep -Fq "pm2 stop forex-backend" "$CALL_LOG"; then
        fail "service was stopped while a broker trade was open"
    fi
    assert_contains "$CALL_LOG" "-X POST http://localhost:3101/api/trading/start"
}

test_ambiguous_intent_with_flat_broker_keeps_management_running() {
    reset_case
    python3 - "$PROJECT_DIR/backend/data/trading.db" <<'PY'
import sqlite3, sys
connection = sqlite3.connect(sys.argv[1])
connection.execute("INSERT INTO broker_order_intents VALUES('AMBIGUOUS')")
connection.commit()
connection.close()
PY
    if bash "$BACKUP_SCRIPT" >/dev/null 2>&1; then
        fail "backup ignored an unresolved local intent while broker appeared flat"
    fi
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db"
    if grep -Fq "pm2 stop forex-backend" "$CALL_LOG"; then
        fail "service was stopped with an unresolved local broker intent"
    fi
}

test_deploy_lock_is_inherited_without_releasing_parent_lock() {
    reset_case
    (
        source "$REPO_ROOT/scripts/deployment-lock.sh"
        forex_acquire_deployment_lock "$BACKUP_DIR/.backup.lock"
        bash "$BACKUP_SCRIPT" >/dev/null
        assert_file "$BACKUP_DIR/trading_20990101_000000.db"
        # An unrelated invocation must remain blocked after backup exits. It
        # cannot borrow the descriptor just by being another child process.
        if (unset FOREX_DEPLOY_LOCK_FD; FOREX_BACKUP_REQUIRE_RUN=1 bash "$BACKUP_SCRIPT" >/dev/null 2>&1); then
            fail "backup released the deployment parent's maintenance lock"
        fi
    )
}

test_environment_marker_without_descriptor_is_rejected() {
    reset_case
    if (exec 9>&-; FOREX_DEPLOY_LOCK_FD=9 bash "$BACKUP_SCRIPT" >/dev/null 2>&1); then
        fail "an environment marker bypassed the maintenance lock"
    fi
    assert_no_file "$BACKUP_DIR/forex_backup_20990101_000000.tar.gz"
    [ ! -s "$CALL_LOG" ] || fail "maintenance began with an invalid inherited lock"
}

test_descriptor_for_another_file_is_rejected() {
    reset_case
    : > "$BACKUP_DIR/.backup.lock"
    if (exec 9>"$BACKUP_DIR/wrong.lock"; FOREX_DEPLOY_LOCK_FD=9 bash "$BACKUP_SCRIPT" >/dev/null 2>&1); then
        fail "an unrelated descriptor bypassed the maintenance lock"
    fi
    assert_no_file "$BACKUP_DIR/forex_backup_20990101_000000.tar.gz"
    [ ! -s "$CALL_LOG" ] || fail "maintenance began with a mismatched inherited lock"
}

test_inherited_descriptor_must_itself_obtain_the_lock() {
    reset_case
    (
        source "$REPO_ROOT/scripts/deployment-lock.sh"
        forex_acquire_deployment_lock "$BACKUP_DIR/.backup.lock"
        # Reopening the same inode creates another open file description. A
        # matching inode alone is insufficient while the parent owns the lock.
        if (exec 9>"$BACKUP_DIR/.backup.lock"; FOREX_BACKUP_REQUIRE_RUN=1 bash "$BACKUP_SCRIPT" >/dev/null 2>&1); then
            fail "matching inode was accepted without holding the lock"
        fi
    )
    assert_no_file "$BACKUP_DIR/forex_backup_20990101_000000.tar.gz"
    [ ! -s "$CALL_LOG" ] || fail "maintenance began while another descriptor held the lock"
}

test_busy_or_unverified_entry_queue_keeps_management_running() {
    local payload
    for payload in \
        '{"isProcessingQueue":true,"queueLength":0}' \
        '{"isProcessingQueue":false,"queueLength":1}' \
        '{"isProcessingQueue":"false","queueLength":0}' \
        '{"isProcessingQueue":false,"queueLength":false}' \
        '{}' 'invalid-json'; do
        reset_case
        export STUB_ENGINE_STATS="$payload"
        if bash "$BACKUP_SCRIPT" >/dev/null 2>&1; then
            fail "backup accepted busy or unverified queue: $payload"
        fi
        assert_no_file "$BACKUP_DIR/trading_20990101_000000.db"
        if grep -Fq 'pm2 stop' "$CALL_LOG" || grep -Fq '/summary' "$CALL_LOG"; then
            fail "backup proceeded beyond the entry-queue guard"
        fi
    done
}

test_unavailable_entry_queue_keeps_management_running() {
    reset_case
    export STUB_ENGINE_STATS_FAIL=1
    if bash "$BACKUP_SCRIPT" >/dev/null 2>&1; then
        fail "backup accepted an unavailable entry queue"
    fi
    assert_no_file "$BACKUP_DIR/trading_20990101_000000.db"
    if grep -Fq 'pm2 stop' "$CALL_LOG" || grep -Fq '/summary' "$CALL_LOG"; then
        fail "backup proceeded beyond the unavailable entry queue"
    fi
}

test_successful_safe_backup
test_lock_collision_skips_without_output
test_required_lock_collision_fails_deploy_gate
test_failed_snapshot_cleans_partial_and_restores_runtime
test_failed_integrity_check_does_not_publish_snapshot
test_open_trade_fails_closed_without_stopping_service
test_ambiguous_intent_with_flat_broker_keeps_management_running
test_deploy_lock_is_inherited_without_releasing_parent_lock
test_environment_marker_without_descriptor_is_rejected
test_descriptor_for_another_file_is_rejected
test_inherited_descriptor_must_itself_obtain_the_lock
test_busy_or_unverified_entry_queue_keeps_management_running
test_unavailable_entry_queue_keeps_management_running
test_backup_restores_enabled_intent_without_clearing_loss_cooldown
test_backup_preserves_operator_pause_during_and_after_cooldown

echo "backup_test.sh: all tests passed"
