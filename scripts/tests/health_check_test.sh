#!/bin/bash
# Isolated fixtures only: no network, broker, production database, or PM2 action.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$SCRIPT_DIR/../health-check.sh"
workspace=$(mktemp -d)
trap 'rm -rf "$workspace"' EXIT
mkdir -p "$workspace/bin" "$workspace/app/backend/data" "$workspace/app/backend/logs"
touch "$workspace/app/backend/data/trading.db"
cat > "$workspace/bin/pm2" <<'MOCK'
#!/bin/bash
[ "${HEALTH_TEST_CASE:-healthy}" != "pm2_offline" ] || { printf '[]\n'; exit 0; }
printf '%s\n' '[{"name":"forex-backend","pm2_env":{"status":"online"}}]'
MOCK
cat > "$workspace/bin/sqlite3" <<'MOCK'
#!/bin/bash
[ "$1" = "-readonly" ] || exit 1
printf '%s\n' "$*" >> "$HEALTH_TEST_SQLITE_LOG"
[[ "${!#}" == *quick_check* && "${!#}" == *broker_order_intents* && "${!#}" == *broker_position_quarantines* ]] || exit 1
case "${HEALTH_TEST_CASE:-healthy}" in
  database_corrupt) printf 'corruption detected\n0\n0\n' ;;
  database_pending) printf 'ok\n1\n0\n' ;;
  database_quarantined) printf 'ok\n0\n1\n' ;;
  database_query_failed) printf 'ok\n'; exit 1 ;;
  database_trailing_space) printf 'ok\n0\n0 \n' ;;
  database_extra_row) printf 'ok\n0\n0\n\n' ;;
  database_timeout) exec node -e 'setTimeout(() => {}, 10000)' ;;
  *) printf 'ok\n0\n0\n' ;;
esac
MOCK
cat > "$workspace/bin/curl" <<'MOCK'
#!/bin/bash
[[ "$*" != *'--config -'* && "$*" != *'Authorization:'* ]] || exit 1
[ "${HEALTH_TEST_CASE:-healthy}" != "unavailable" ] || exit 1
[ "${HEALTH_TEST_CASE:-healthy}" != "malformed" ] || { printf 'not JSON\n'; exit 0; }
[ "${HEALTH_TEST_CASE:-healthy}" != "invalid_shape" ] || { printf '[]\n'; exit 0; }
node - <<'JS'
const scenario=process.env.HEALTH_TEST_CASE || 'healthy';
const health={status:'healthy',checkedAt:Date.now(),issues:[],entryState:'WATCHING'};
const data={operationalHealth:health,services:{oanda:{connected:true}},
    liveSelection:{strategy:'intraday_momentum',liveRun:{runId:'fixture-live',mode:'live',status:'active'}},
    config:{enableTrading:true},liveReadiness:{passed:true,status:'PASS'}};
if(scenario==='weekend') health.entryState='MARKET_CLOSED';
if(scenario==='healthy_h4'){
    data.liveSelection.strategy='multi_day_trend';
    data.liveSelection.liveRun.strategy='multi_day_trend';
    Object.assign(data.config,{strategy:'multi_day_trend',timeframe:'4h',liveReleaseVersion:'h4-channel-v1',executionPolicyVersion:'h4-channel-risk-v1'});
}
if(scenario==='unknown_strategy') data.liveSelection.strategy='unknown_strategy';
if(scenario==='cooldown'){health.entryState='COOLDOWN';data.liveReadiness={passed:false,status:'COOLDOWN'};}
if(scenario==='broker_offline') data.services.oanda.connected=false;
if(['quiet_prices','pricing_delivery_failed'].includes(scenario)){
    // Old broker events remain healthy with current validated response receipts.
    const expired=scenario==='pricing_delivery_failed';
    data.services.dataService={freshness:{pricesFresh:!expired,oldestPriceAgeMs:80001,oldestPriceReceiptAgeMs:expired?20001:0}};
    if(expired){health.status='degraded';health.issues=[{code:'STALE_PRICE_DATA',instrument:'EUR_USD',message:'EUR_USD: last validated pricing response 21 seconds ago (20-second delivery limit)'}];}
}
if(scenario==='unprotected'){health.status='degraded';health.issues=[{message:'EUR_USD has no recorded protective stop'}];}
if(scenario==='stale') health.checkedAt-=240000;
if(scenario==='invalid_timestamp') health.checkedAt='NONFINITE_TEST_TOKEN';
if(scenario==='readiness_failed') data.liveReadiness={passed:false,status:'FAIL'};
console.log(JSON.stringify(data).replace('"NONFINITE_TEST_TOKEN"','NaN'));
JS
MOCK
chmod +x "$workspace/bin/pm2" "$workspace/bin/sqlite3" "$workspace/bin/curl"
export PATH="$workspace/bin:$PATH"
export FOREX_PROJECT_DIR="$workspace/app" FOREX_NODE_RUNTIME_LOADED=1
export HEALTH_TEST_SQLITE_LOG="$workspace/sqlite.log"
unset FOREX_OPERATOR_TOKEN

for scenario in healthy healthy_h4 quiet_prices weekend cooldown; do
    : > "$HEALTH_TEST_SQLITE_LOG"
    HEALTH_TEST_CASE="$scenario" bash "$CHECK" > "$workspace/output" || {
        cat "$workspace/output"
        echo "Expected healthy result for $scenario" >&2
        exit 1
    }
    [ "$(wc -l < "$HEALTH_TEST_SQLITE_LOG" | tr -d ' ')" = 1 ] || {
        echo "Expected the complete database check for $scenario" >&2
        exit 1
    }
    grep -q 'Database: integrity verified' "$workspace/output"
    grep -q 'Broker lifecycle: resolved' "$workspace/output"
done
for scenario in unavailable broker_offline pricing_delivery_failed unprotected stale readiness_failed malformed invalid_shape invalid_timestamp pm2_offline unknown_strategy; do
    : > "$HEALTH_TEST_SQLITE_LOG"
    if HEALTH_TEST_CASE="$scenario" bash "$CHECK" > "$workspace/output"; then
        cat "$workspace/output"
        echo "Expected failed result for $scenario" >&2
        exit 1
    fi
    [ ! -s "$HEALTH_TEST_SQLITE_LOG" ] || {
        echo "SQLite must not be invoked while the runtime is unready: $scenario" >&2
        exit 1
    }
    grep -q 'Database: verification deferred' "$workspace/output"
done
for scenario in database_corrupt database_pending database_quarantined database_query_failed database_trailing_space database_extra_row database_timeout; do
    : > "$HEALTH_TEST_SQLITE_LOG"
    if HEALTH_TEST_CASE="$scenario" FOREX_HEALTH_DB_TIMEOUT_SECONDS=0.2 bash "$CHECK" > "$workspace/output"; then
        cat "$workspace/output"
        echo "Expected failed database result for $scenario" >&2
        exit 1
    fi
    [ "$(wc -l < "$HEALTH_TEST_SQLITE_LOG" | tr -d ' ')" = 1 ]
    case "$scenario" in
        database_corrupt) grep -q 'Database: integrity could not be verified' "$workspace/output" ;;
        database_pending) grep -q '1 unresolved stale intent(s)' "$workspace/output" ;;
        database_quarantined) grep -q '1 quarantined position(s)' "$workspace/output" ;;
        database_query_failed|database_trailing_space|database_extra_row) grep -q 'Broker lifecycle: database state could not be verified' "$workspace/output" ;;
        database_timeout) grep -q 'Database: verification timed out after 0.2 seconds' "$workspace/output" ;;
    esac
done
echo "Health check fixtures passed (23 scenarios)."
