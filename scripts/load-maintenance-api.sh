#!/bin/bash
# Local maintenance API calls need no login on this private-network tool.

forex_api_curl() (
    set +x
    if [ "${FOREX_DEPLOY_LEGACY_ACCESS:-0}" != 1 ]; then
        curl -q --fail --silent --show-error --connect-timeout 5 --max-time 20 "$@"
        exit $?
    fi

    # Upgrade compatibility only: an already-running September 6 release may
    # still require its saved token before we can pause it. A completed 401 is
    # the only response retried; ambiguous mutations must never be replayed.
    umask 077
    response=$(mktemp)
    trap 'rm -f "$response" "$response.error"' EXIT
    status=0
    code=$(curl -q --fail --silent --show-error --connect-timeout 5 --max-time 20 \
        "$@" --output "$response" --write-out '%{http_code}' 2>"$response.error") || status=$?
    if [ "$code" != 401 ] || [ "$status" -ne 22 ]; then
        cat "$response"
        cat "$response.error" >&2
        exit "$status"
    fi
    project="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
    token=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
        -pass "file:$project/.keys/encryption.key" \
        -in "$project/.secrets/operator_token.enc" 2>/dev/null) || {
        echo "The running legacy release requires its existing saved credential before replacement." >&2
        exit 1
    }
    [[ "$token" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "The saved legacy credential is invalid." >&2; exit 1; }
    printf 'header = "Authorization: Bearer %s"\n' "$token" |
        curl -q --config - --fail --silent --show-error \
            --connect-timeout 5 --max-time 20 "$@"
)

forex_broker_account_summary() (
    set +x
    local project="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
    local broker_token="${OANDA_API_KEY:-}" account_id="${OANDA_ACCOUNT_ID:-}" environment="${OANDA_ENVIRONMENT:-}"
    local key="$project/.keys/encryption.key"
    if [ -z "$broker_token" ]; then
        broker_token=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass "file:$key" -in "$project/.secrets/oanda_api_key.enc" 2>/dev/null) || return 1
    fi
    if [ -z "$account_id" ]; then
        account_id=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass "file:$key" -in "$project/.secrets/oanda_account_id.enc" 2>/dev/null) || return 1
    fi
    if [ -z "$environment" ]; then
        environment=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass "file:$key" -in "$project/.secrets/oanda_environment.enc" 2>/dev/null) || return 1
    fi
    [[ "$account_id" =~ ^[0-9-]+$ ]] && [[ "$broker_token" =~ ^[a-zA-Z0-9_-]+$ ]] || return 1
    local host
    case "$environment" in
        live) host="https://api-fxtrade.oanda.com" ;;
        practice) host="https://api-fxpractice.oanda.com" ;;
        *) echo "Broker environment must be explicitly live or practice" >&2; return 1 ;;
    esac
    printf 'header = "Authorization: Bearer %s"\n' "$broker_token" |
        curl -q --config - --fail --silent --show-error --connect-timeout 5 --max-time 20 \
            "$host/v3/accounts/$account_id/summary"
)

# The first upgraded release still runs the old entry code until cutover. That
# code can retain enabled=true while waiting for network work, before recording
# an order intent. Confirm that this work has drained after the durable pause;
# flat broker/local ledgers alone cannot exclude it.
forex_require_entry_queue_idle() (
    set +x
    local api_url="${FOREX_API_URL:-http://localhost:3101/api}"
    local queue helper_dir
    helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    queue=$(forex_api_curl "$api_url/engine/stats") || {
        echo "Cannot verify that in-flight entry processing has drained" >&2
        exit 1
    }
    printf '%s' "$queue" | node "$helper_dir/maintenance-tools.cjs" queue-idle || {
        echo "Entry processing is busy or unverified; management remains running" >&2
        exit 1
    }
)

# A successful earlier preflight cannot authorize a later cutover: entries may
# have been enabled during dependency/build preparation. Call again just before
# stopping the process. This helper performs only local reads and broker GETs.
forex_require_paused_flat_running() (
    set +x
    local project="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
    local api_url="${FOREX_API_URL:-http://localhost:3101/api}"
    local helper_dir health broker
    helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    node "$helper_dir/restore-safety.cjs" "$project" || exit 1
    health=$(forex_api_curl "$api_url/health") || {
        echo "Cannot verify a running, paused API before cutover" >&2; exit 1;
    }
    printf '%s' "$health" | node "$helper_dir/maintenance-tools.cjs" entries-paused || {
        echo "Running API does not confirm paused entries" >&2; exit 1;
    }
    forex_require_entry_queue_idle || exit 1
    broker=$(forex_broker_account_summary) || {
        echo "Cannot verify broker state before cutover" >&2; exit 1;
    }
    printf '%s' "$broker" | node "$helper_dir/maintenance-tools.cjs" broker-flat || {
        echo "Broker has open trades, pending orders, or unknown state" >&2; exit 1;
    }
)
