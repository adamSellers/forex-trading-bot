# scripts/deploy-check.sh - Shared runtime rollout preflight
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/load-node-runtime.sh"

echo "🩺 Running shared runtime deployment checks..."

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

check_passed=0
check_failed=0

check() {
    if eval "$2"; then
        echo -e "${GREEN}✅ $1${NC}"
        ((check_passed++))
    else
        echo -e "${RED}❌ $1${NC}"
        ((check_failed++))
    fi
}

# Test current git status
check "Git status clean" "git diff --quiet && git diff --cached --quiet"
check "On main branch" "[[ \$(git branch --show-current) == 'main' ]]"

# Test local artifacts and dependencies
check "Frontend dist exists (run 'cd frontend && npm run build' manually first)" "[ -d frontend/dist ]"
check "Backend dependencies OK" "(cd backend && npm ls --omit=dev > /dev/null 2>&1)"
check "Frontend dependencies OK" "(cd frontend && npm ls > /dev/null 2>&1)"
check "Shared runtime migration present" "[ -f backend/migrations/005_add_strategy_runs_and_runtime_identity.js ]"
check "Backtest retirement migration present" "[ -f backend/migrations/006_drop_backtest_results.js ]"
check "Legacy backtest CLI removed from supported path" "[ ! -f scripts/backtest.js ] && [ ! -f scripts/backtestSweep.js ]"

# Test local API endpoints (if backend is running)
if curl -f -s http://localhost:3101/api/health > /dev/null 2>&1; then
    endpoints=(
        "http://localhost:3101/api/health"
        "http://localhost:3101/api/runtime/live-selection"
        "http://localhost:3101/api/runtime/runs"
        "http://localhost:3101/api/analytics?period=7d&mode=live"
    )

    for endpoint in "${endpoints[@]}"; do
        check "Local API: $endpoint" "curl -f -s '$endpoint' > /dev/null 2>&1"
    done
else
    echo "⚠️ Local backend not running - skipping API tests"
fi

# Test root package orchestration. This repo does not use npm workspaces; the
# root package delegates into backend/frontend through explicit scripts.
check "Root install scripts exist" "grep -q 'install:backend' package.json && grep -q 'install:frontend' package.json && grep -q 'install:all' package.json"
check "Root migration script exists" "grep -q 'db:migrate' package.json"

echo
if [[ $check_failed -eq 0 ]]; then
    echo -e "${GREEN}✅ All checks passed! Ready for deployment.${NC}"
    exit 0
else
    echo -e "${RED}❌ $check_failed checks failed. Fix issues before deploying.${NC}"
    exit 1
fi
