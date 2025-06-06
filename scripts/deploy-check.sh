# scripts/deploy-check.sh - FIXED VERSION
#!/bin/bash
set -e

echo "🩺 Running deployment health checks..."

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
check "Up to date with origin" "git fetch origin && git diff --quiet HEAD origin/main"

# Test local build
check "Frontend builds successfully" "cd frontend && npm run build > /dev/null 2>&1"
check "Backend dependencies OK" "cd backend && npm ls > /dev/null 2>&1"

# Test local API endpoints (if backend is running)
if curl -f -s http://localhost:3001/api/management/health > /dev/null 2>&1; then
    endpoints=(
        "http://localhost:3001/api/management/health"
        "http://localhost:3001/api/trading/status"
        "http://localhost:3001/api/trading/prices"
    )

    for endpoint in "${endpoints[@]}"; do
        check "Local API: $endpoint" "curl -f -s '$endpoint' > /dev/null 2>&1"
    done
else
    echo "⚠️ Local backend not running - skipping API tests"
fi

# Test workspace configuration
check "Root package.json has workspaces" "grep -q '\"workspaces\"' package.json"
check "Workspace install scripts exist" "grep -q 'install:backend' package.json && grep -q 'install:frontend' package.json"

echo
if [[ $check_failed -eq 0 ]]; then
    echo -e "${GREEN}✅ All checks passed! Ready for deployment.${NC}"
    exit 0
else
    echo -e "${RED}❌ $check_failed checks failed. Fix issues before deploying.${NC}"
    exit 1
fi