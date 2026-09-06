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
printf '%s\n' '[{"name":"forex-backend","pm2_env":{"status":"online"}}]'
MOCK
cat > "$workspace/bin/sqlite3" <<'MOCK'
#!/bin/bash
[ "$1" = "-readonly" ] || exit 1
case "${!#}" in
  *quick_check*) printf 'ok\n' ;;
  *) printf '0\n' ;;
esac
MOCK
cat > "$workspace/bin/curl" <<'MOCK'
#!/bin/bash
[[ "$*" != *'--config -'* && "$*" != *'Authorization:'* ]] || exit 1
[ "${HEALTH_TEST_CASE:-healthy}" != "unavailable" ] || exit 1
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
if case == "readiness_failed": data["liveReadiness"]={"passed":False,"status":"FAIL"}
print(json.dumps(data))
PY
MOCK
chmod +x "$workspace/bin/pm2" "$workspace/bin/sqlite3" "$workspace/bin/curl"
export PATH="$workspace/bin:$PATH"
export FOREX_PROJECT_DIR="$workspace/app" FOREX_NODE_RUNTIME_LOADED=1
unset FOREX_OPERATOR_TOKEN

for scenario in healthy weekend cooldown; do
    HEALTH_TEST_CASE="$scenario" bash "$CHECK" > "$workspace/output" || {
        cat "$workspace/output"
        echo "Expected healthy result for $scenario" >&2
        exit 1
    }
done
for scenario in unavailable broker_offline unprotected stale readiness_failed; do
    if HEALTH_TEST_CASE="$scenario" bash "$CHECK" > "$workspace/output"; then
        cat "$workspace/output"
        echo "Expected failed result for $scenario" >&2
        exit 1
    fi
done
echo "Health check fixtures passed (8 scenarios)."
