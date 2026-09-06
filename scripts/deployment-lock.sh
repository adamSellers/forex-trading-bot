#!/bin/bash
# Source this helper and call it in the current shell. The shared maintenance
# lock remains on descriptor 9 until that shell exits. Children may reuse the
# descriptor only when it names the expected lock file and can hold its lock.

forex_acquire_deployment_lock() {
    local lock_file="${1:?Maintenance lock path is required}"
    command -v flock >/dev/null 2>&1 || {
        echo "flock is required for safe maintenance" >&2
        return 1
    }

    if [ -n "${FOREX_DEPLOY_LOCK_FD:-}" ]; then
        if [ "$FOREX_DEPLOY_LOCK_FD" != 9 ]; then
            echo "Invalid inherited maintenance lock descriptor" >&2
            return 2
        fi
        # An environment marker alone never authorizes maintenance. fstat
        # checks the inherited descriptor itself, not a process-id claim or a
        # pathname string supplied by the caller. flock then proves that this
        # open file description can hold the exclusive maintenance lock.
        if ! python3 - "$lock_file" <<'PY'
import os
import stat
import sys

try:
    expected = os.stat(sys.argv[1])
    inherited = os.fstat(9)
    valid = stat.S_ISREG(expected.st_mode) and stat.S_ISREG(inherited.st_mode)
    valid = valid and (expected.st_dev, expected.st_ino) == (inherited.st_dev, inherited.st_ino)
except (OSError, ValueError):
    valid = False
sys.exit(0 if valid else 1)
PY
        then
            echo "Inherited maintenance lock does not match the expected lock file" >&2
            return 2
        fi
    else
        exec 9>"$lock_file" || return 1
    fi

    if ! flock -n 9; then
        return 75
    fi
    export FOREX_DEPLOY_LOCK_FD=9
}
