#!/bin/bash
# One-command release deployment, from the developer checkout or the Pi.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
BRANCH="${FOREX_BRANCH:-main}"
HOST="${FOREX_DEPLOY_HOST:-adam@img.oakroad}"
[ "$#" -eq 0 ] || { echo "Usage: ./scripts/deploy.sh" >&2; exit 2; }
# SSH parses a remote shell command. Restrict its configurable arguments before
# interpolation; credentials are neither arguments nor part of the script body.
[[ "$HOST" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]*$ ]] || { echo "Invalid deployment host" >&2; exit 2; }
[[ "$PROJECT_DIR" =~ ^/[a-zA-Z0-9_./-]+$ ]] && [[ "$PROJECT_DIR" != *'/../'* ]] || { echo "Invalid production path" >&2; exit 2; }
[[ "$BRANCH" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$ ]] || { echo "Invalid release branch" >&2; exit 2; }
if [ "$(cd "$SCRIPT_DIR/.." && pwd)" = "$PROJECT_DIR" ]; then
    exec bash "$SCRIPT_DIR/deploy-remote.sh" "$PROJECT_DIR" "$BRANCH"
fi
echo "Deploying published $BRANCH to $HOST..."
exec ssh "$HOST" "bash -s -- '$PROJECT_DIR' '$BRANCH'" < "$SCRIPT_DIR/deploy-remote.sh"
