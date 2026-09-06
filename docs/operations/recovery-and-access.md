# Recovery and maintenance reference

For an ordinary deployment, use [the one-command guide](../../scripts/DEPLOYMENT_README.md). These details cover exceptional recovery and broker credentials.

## Deployment failures

Preparation runs in a private Git archive outside the installation. A dependency, test, build, backup or preflight failure leaves deployed source and dependencies unchanged. The script attempts to restore the previously enabled state through the API and verifies the result; a readiness block leaves entries paused. Open positions, pending orders or a busy entry queue defer stopping while position management continues.

After cutover begins, a failed migration, artifact move, restart or health check is a failed deployment. The command attempts an entry pause, reports that current process/trading state needs inspection, and preserves the stage path printed in its output. This stage contains the pinned release, any previous dependency/build directories already moved aside, and the health log if health checks ran. The verified source archive and matching SQLite snapshot are in `~/forex-trading-bot-backups`. There is no automatic database rollback or promise that a stopped, broken release can recover by rerunning deployment. Use the staged restore procedure below after verifying broker truth. Source archives that lack the current maintenance helper require the database-only recovery path with reviewed current code.

Once the installation is running again, rerunning deployment repeats every preparation and health gate even if Git already points at the target commit. A Git revision alone is not evidence that deployment finished. The shared lock covers the whole deployment, including the nested backup and trading-state restoration; concurrent deployment/backup/restore cannot cut over together. Preparation failures remove staging; cutover failures retain it for inspection. Remove retained stages only after recovery is verified.

## Private-network access

The user explicitly removed application authentication on 2026-09-07. The dashboard opens directly; API routes, Socket.IO, startup and maintenance require no operator token. Access comes from the existing private internal-network arrangement. `CORS_ALLOWED_ORIGINS` (or `CORS_ORIGIN`) retains the configured dashboard origins, including `http://fx.oakroad`; it does not introduce a login. Broker, email and S3 credentials remain encrypted and server-side.

Maintenance scripts source `load-maintenance-api.sh`. Local API calls use bounded curl requests without an Authorization header. Direct OANDA checks still use the broker credential, sent through curl configuration on stdin.

For the one transition from the former login-gated release, deployment alone may retry a completed HTTP 401 using the already-saved encrypted legacy token. This lets it pause and back up that old process automatically. It never provisions a token, retries an ambiguous mutation, or requires a token when the API already works without one. The compatibility flag is removed before starting/verifying the new process. Existing unused legacy token files are left alone; the new app and its startup do not read them.

## Backups

The daily backup shares a nonblocking lock with deployment and restores, keeps three source archives and verified SQLite snapshots, uses bounded SQLite copy/integrity checks and atomic publication, and refuses to stop management while broker exposure or pending orders exist. It pauses new entries, requires a flat broker, briefly stops the process for the copy, and restores the previous enabled state through live readiness. An open trade defers the DB copy; the separately created source archive can therefore have no matching snapshot. `--archive-only` also has no database snapshot. A full restore must never silently select some other newest DB.

```bash
./scripts/backup.sh
./scripts/backup.sh --archive-only
FOREX_BACKUP_RETENTION=3 ./scripts/backup.sh
```

Archives exclude `.env`, `.keys`, `.secrets`, TLS material and live SQLite/WAL files. They are **not** complete credential recovery. Store independently recoverable copies of verified SQLite snapshots, source release identity and protected credentials outside the Pi/root filesystem. Confirm storage access and perform an isolated restore drill; merely configuring S3 analytics does not establish full recovery or guarantee report delivery.

## Staged restore

Restore accepts an exact archive/snapshot path. An archive `forex_backup_TIMESTAMP.tar.gz` requires `trading_TIMESTAMP.db` in the same directory; no newest-file fallback is permitted. A `.db` restores database history into a staged copy of current source. Older source archives should use the database-only path with reviewed current code; source archives lacking `load-maintenance-api.sh` are rejected.

First run offline validation (no broker calls, process changes or live activation):

```bash
./scripts/restore.sh "$HOME/forex-trading-bot-backups/forex_backup_TIMESTAMP.tar.gz" --verify-only
```

Validation rejects unsafe paths, archive links/special files, credential-bearing archives, corrupt SQLite, missing lifecycle schema, open live trades and unresolved intent/quarantine state in the snapshot. It copies the current installation's credentials/TLS/Git context into a private candidate; the temporary candidate is removed after verification. A valid snapshot is necessary but not sufficient to authorize replacement.

For actual recovery, stop new entries and verify no broker positions/pending orders and no unresolved current DB intents/quarantines. A running API must confirm paused entries. If the API is down, PM2 must report the process stopped and the on-disk config must already be paused. The script independently reads the broker summary using encrypted credentials; unavailable broker truth fails closed.

```bash
./scripts/restore.sh "$HOME/forex-trading-bot-backups/forex_backup_TIMESTAMP.tar.gz"
# Or restore a verified DB snapshot into current reviewed source:
./scripts/restore.sh "$HOME/forex-trading-bot-backups/trading_TIMESTAMP.db"
```

After explicit `RESTORE` confirmation, dependencies, frontend and schema are prepared only in staging. Source and database must validate before stopping the service. Broker/pause checks run again immediately before cutover. Staging and installation must share a filesystem for atomic directory moves. The entire original installation, database and secrets move to `/opt/forex-trading-bot.rollback.TIMESTAMP`; no original directory is deleted. The candidate is installed, starts **paused**, and must pass operational health. It never auto-enables live entries.

A failure after cutover stops the candidate and preserves the original rollback directory. It does not automatically restart either copy or resume entries. Keep both copies, inspect the exact failed step and verify broker truth. If restoring the original directory manually, ensure its config remains paused; move the failed candidate aside, move the preserved directory back, and run the appropriate reviewed migration/restart/health checks. Do not delete the rollback until recovery, credentials and history are independently verified. `RESTORE_MANIFEST.json` records the source/snapshot path and snapshot SHA-256; review the preserved Git context/diff before any later update of a restored historical source tree.

Loss of the entire installation requires recovering the encryption key and encrypted broker credentials into a reviewed fresh checkout before this workflow. Do not generate a replacement key for existing encrypted secrets: it cannot decrypt the old credentials.

## Database free-page maintenance

The September review found roughly 83% free pages inside the allocated database file. This is a maintenance opportunity, not an automatic cleanup instruction. During an approved paused/flat maintenance window: verify an independent backup; record database size/schema/row counts and `PRAGMA quick_check`; stop the process; create a separate compact copy using SQLite `VACUUM INTO` with sufficient free space; validate its integrity, required tables and retained row counts; preserve the original DB and WAL/SHM state before replacement; restart paused and reconcile OANDA. Do not run VACUUM on a live writer, delete the original first, or treat filesystem free space as trading performance.

## Local isolated verification

```bash
cd backend
npm test -- --runInBand
cd ..
bash scripts/tests/backup_test.sh
bash scripts/tests/health_check_test.sh
python3 scripts/tests/restore_test.py
python3 scripts/tests/deployment_test.py
node scripts/tests/frontend_refresh_contract.test.cjs
```

Deployment and restore tests use isolated fixtures and stub external operations; they perform no real deployments, broker requests or builds. A successful test is not a production restore drill. Build and deploy remain user-managed steps.

## Startup checkpoint and health diagnostics

As of the September 7 local correction, an unready runtime fails deployment health immediately and defers SQLite verification. Once ready, read-only integrity/lifecycle verification has a 60-second total deadline. Daily/startup retention checkpoints run in a separate Node process with immediate contention deferral and a five-second total deadline, preserving TRUNCATE without a 30-second native wait on the trading event loop. A busy checkpoint is retried on the next retention sweep. See [the startup incident](../reviews/2026-09-07-startup-checkpoint.md) for production evidence and rollout status.
