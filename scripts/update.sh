#!/bin/bash
# The Pi's familiar update command uses the same pinned release workflow.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ "$#" -eq 0 ] || { echo "Usage: ./scripts/update.sh" >&2; exit 2; }
exec bash "$SCRIPT_DIR/deploy-remote.sh" "${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}" "${FOREX_BRANCH:-main}"
