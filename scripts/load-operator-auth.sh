#!/bin/bash
# Source this helper; it does not print credentials or contact the broker.

load_forex_operator_token() {
    # Do not expose decrypted credentials through shell tracing.
    case $- in *x*) set +x ;; esac
    local project="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
    if [ -z "${FOREX_OPERATOR_TOKEN:-}" ]; then
        [ -f "$project/.keys/encryption.key" ] && [ -f "$project/.secrets/operator_token.enc" ] || {
            echo "Operator access is not configured. Run setup-operator-access.sh before maintenance." >&2
            return 1
        }
        FOREX_OPERATOR_TOKEN=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
            -pass "file:$project/.keys/encryption.key" \
            -in "$project/.secrets/operator_token.enc" 2>/dev/null) || return 1
    fi
    if [[ ! "$FOREX_OPERATOR_TOKEN" =~ ^[a-fA-F0-9]{64}$ ]]; then
        echo "Invalid operator credential; expected a 32-byte hexadecimal token." >&2
        return 1
    fi
    export FOREX_OPERATOR_TOKEN
}

forex_api_curl() (
    set +x
    load_forex_operator_token || exit 1
    # curl reads the authorization header from stdin, never from argv or a
    # world-readable file. -q ignores per-user curl config/trace/redirect flags.
    printf 'header = "Authorization: Bearer %s"\n' "$FOREX_OPERATOR_TOKEN" |
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

# A successful earlier preflight cannot authorize a later cutover: entries may
# have been enabled during dependency/build preparation. Call again just before
# stopping the process. This helper performs only local reads and broker GETs.
forex_require_paused_flat_running() (
    set +x
    local project="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
    local api_url="${FOREX_API_URL:-http://localhost:3101/api}"
    local helper_dir health broker
    helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    python3 "$helper_dir/restore-safety.py" "$project" || exit 1
    health=$(forex_api_curl "$api_url/health") || {
        echo "Cannot verify a running, paused API before cutover" >&2; exit 1;
    }
    printf '%s' "$health" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if (d.get("config") or {}).get("enableTrading") is False else 1)' || {
        echo "Running API does not confirm paused entries" >&2; exit 1;
    }
    broker=$(forex_broker_account_summary) || {
        echo "Cannot verify broker state before cutover" >&2; exit 1;
    }
    printf '%s' "$broker" | python3 -c 'import json,sys; a=json.load(sys.stdin).get("account",{}); sys.exit(0 if str(a.get("openTradeCount")) == "0" and str(a.get("pendingOrderCount")) == "0" else 1)' || {
        echo "Broker has open trades, pending orders, or unknown state" >&2; exit 1;
    }
)
