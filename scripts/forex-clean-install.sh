#!/bin/bash
# The historical destructive installer is retired. Existing installations must
# use guarded update or staged restore so credentials/history survive.
set -Eeuo pipefail
PROJECT_DIR="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
if [ -e "$PROJECT_DIR" ]; then
    echo "Refusing to remove an existing installation. Use scripts/update.sh or scripts/restore.sh after pausing and verifying broker state." >&2
    exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/first_time_setup.sh"
