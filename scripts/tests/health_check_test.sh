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
  database_timeout) exec python3 -c 'import time; time.sleep(10)' ;;
  *) printf 'ok\n0\n0\n' ;;
esac
MOCK
cat > "$workspace/bin/curl" <<'MOCK'
#!/bin/bash
[[ "$*" != *'--config -'* && "$*" != *'Authorization:'* ]] || exit 1
[ "${HEALTH_TEST_CASE:-healthy}" != "unavailable" ] || exit 1
[ "${HEALTH_TEST_CASE:-healthy}" != "malformed" ] || { printf 'not JSON\n'; exit 0; }
[ "${HEALTH_TEST_CASE:-healthy}" != "invalid_shape" ] || { printf '[]\n'; exit 0; }
python3 - <<'PY'
import json,os,time
case=os.environ.get("HEALTH_TEST_CASE", "healthy")
health={"status":"healthy", "checkedAt":int(time.time()*1000), "issues":[], "entryState":"WATCHING"}
data={"operationalHealth":health, "services":{"oanda":{"connected":True}},
      "liveSelection":{"strategy":"intraday_momentum", "liveRun":{"runId":"fixture-live", "mode":"live", "status":"active"}},
      "config":{"enableTrading":True}, "liveReadiness":{"passed":True,"status":"PASS"}}
if case == "weekend": health["entryState"]="MARKET_CLOSED"
if case == "cooldown":
    health["entryState"]="COOLDOWN"
    data["liveReadiness"]={"passed":False,"status":"COOLDOWN"}
if case == "broker_offline": data["services"]["oanda"]["connected"]=False
if case == "unprotected":
    health["status"]="degraded"
    health["issues"]=[{"message":"EUR_USD has no recorded protective stop"}]
if case == "stale": health["checkedAt"]-=240000
if case == "invalid_timestamp": health["checkedAt"]=float("nan")
if case == "readiness_failed": data["liveReadiness"]={"passed":False,"status":"FAIL"}
print(json.dumps(data))
PY
MOCK
chmod +x "$workspace/bin/pm2" "$workspace/bin/sqlite3" "$workspace/bin/curl"
export PATH="$workspace/bin:$PATH"
export FOREX_PROJECT_DIR="$workspace/app" FOREX_NODE_RUNTIME_LOADED=1
export HEALTH_TEST_SQLITE_LOG="$workspace/sqlite.log"
unset FOREX_OPERATOR_TOKEN

for scenario in healthy weekend cooldown; do
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
for scenario in unavailable broker_offline unprotected stale readiness_failed malformed invalid_shape invalid_timestamp pm2_offline; do
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
for scenario in database_corrupt database_pending database_quarantined database_query_failed database_timeout; do
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
        database_query_failed) grep -q 'Broker lifecycle: database state could not be verified' "$workspace/output" ;;
        database_timeout) grep -q 'Database: verification timed out after 0.2 seconds' "$workspace/output" ;;
    esac
done
echo "Health check fixtures passed (17 scenarios)."
