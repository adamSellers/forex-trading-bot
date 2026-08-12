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
    grep -Fq "$2" "$1" || fail "expected '$2' in $1"
}

mkdir -p "$STUB_BIN"

cat > "$STUB_BIN/flock" <<'EOF'
#!/bin/bash
[ "${STUB_FLOCK_FAIL:-0}" != 1 ]
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
    *'/trading/stop'*) echo '{"success":true}' ;;
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
export FOREX_PROJECT_DIR="$PROJECT_DIR"
export FOREX_BACKUP_DIR="$BACKUP_DIR"
export FOREX_BACKUP_RETENTION=3
export FOREX_BACKUP_TIMEOUT_SECONDS=60
export FOREX_BACKUP_TIMESTAMP=20990101_000000

reset_case() {
    rm -rf "$PROJECT_DIR" "$BACKUP_DIR"
    mkdir -p "$PROJECT_DIR/backend/data" "$BACKUP_DIR"
    printf 'database\n' > "$PROJECT_DIR/backend/data/trading.db"
    : > "$CALL_LOG"
    unset STUB_FLOCK_FAIL STUB_OPEN_TRADES STUB_SQLITE_BACKUP_FAIL STUB_SQLITE_INTEGRITY_FAIL
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
    assert_contains "$CALL_LOG" "curl -sf --max-time 20 -X POST http://localhost:3101/api/trading/stop"
    assert_contains "$CALL_LOG" "pm2 stop forex-backend --silent"
    assert_contains "$CALL_LOG" "pm2 start forex-backend --env production"
    assert_contains "$CALL_LOG" "curl -sf --max-time 20 -X POST http://localhost:3101/api/trading/start"
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
    assert_contains "$CALL_LOG" "curl -sf --max-time 20 -X POST http://localhost:3101/api/trading/start"
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
    assert_contains "$CALL_LOG" "curl -sf --max-time 20 -X POST http://localhost:3101/api/trading/start"
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
    assert_contains "$CALL_LOG" "curl -sf --max-time 20 -X POST http://localhost:3101/api/trading/start"
}

test_successful_safe_backup
test_lock_collision_skips_without_output
test_required_lock_collision_fails_deploy_gate
test_failed_snapshot_cleans_partial_and_restores_runtime
test_failed_integrity_check_does_not_publish_snapshot
test_open_trade_fails_closed_without_stopping_service

echo "backup_test.sh: all tests passed"
