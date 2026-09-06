#!/bin/bash
# Bootstrap runs over SSH stdin, so the previous release need not contain any
# new deployment helpers. The pinned Git archive supplies all of them.
set -Eeuo pipefail
umask 077
export FOREX_PROJECT_DIR="${1:?Production path required}"
branch="${2:-main}"
export FOREX_BACKUP_DIR="${FOREX_BACKUP_DIR:-$HOME/forex-trading-bot-backups}"
cd "$FOREX_PROJECT_DIR"
git check-ref-format --branch "$branch" >/dev/null
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Deployment deferred: tracked working tree changes need review." >&2; exit 1; }
mkdir -p "$FOREX_BACKUP_DIR"
command -v flock >/dev/null || { echo "flock is required for deployment." >&2; exit 1; }
exec 9>"$FOREX_BACKUP_DIR/.backup.lock"
flock -n 9 || { echo "Deployment deferred: another deployment, backup or restore is running." >&2; exit 75; }
stage=""
cleanup() {
    local status=$?
    trap - EXIT
    if [ -n "$stage" ]; then
        if [ -f "$stage/.cutover-started" ] && [ "$status" -ne 0 ]; then
            echo "Recovery files retained at $stage; see docs/operations/recovery-and-access.md." >&2
        else
            rm -rf "$stage"
        fi
    fi
    # Explicitly release the parent lock even if a descendant retained fd9.
    flock -u 9 || true
    exec 9>&-
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
export FOREX_DEPLOY_LOCK_FD=9
export FOREX_DEPLOY_EXPECTED_HEAD
FOREX_DEPLOY_EXPECTED_HEAD=$(git rev-parse HEAD)
git fetch origin "$branch"
export FOREX_DEPLOY_REVISION
FOREX_DEPLOY_REVISION=$(git rev-parse --verify "refs/remotes/origin/$branch^{commit}")
git merge-base --is-ancestor "$FOREX_DEPLOY_EXPECTED_HEAD" "$FOREX_DEPLOY_REVISION" || { echo "Deployment deferred: production cannot fast-forward to the published release." >&2; exit 1; }
stage=$(mktemp -d "$FOREX_BACKUP_DIR/.deploy-stage.XXXXXX")
git archive "$FOREX_DEPLOY_REVISION" | tar -x -C "$stage"
[ -f "$stage/scripts/deploy-release.sh" ] || { echo "The published release lacks the one-command deploy workflow. Push the reviewed changes first." >&2; exit 1; }
bash "$stage/scripts/deploy-release.sh"
