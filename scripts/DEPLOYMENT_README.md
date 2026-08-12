# Live Deployment

Production lives at `/opt/forex-trading-bot` on `adam@img.oakroad`. Verify that path before acting. Source changes must be committed and pushed; never edit deployed source directly.

## Normal update

The update script verifies a clean tree, checks that new entries are paused, creates a database/config backup, fast-forwards from `origin/main`, installs locked dependencies, runs the backend suite, builds the frontend, migrates SQLite, restarts PM2 and runs the live health check.

```bash
ssh adam@img.oakroad
cd /opt/forex-trading-bot
./scripts/update.sh
```

Use `deploy.sh` only for a new installation or major dependency/runtime repair.

## Live-state procedure

1. Confirm OANDA and the local engine report no open position.
2. Record whether live entries are enabled.
3. Pause new entries for the update. Do not close a broker position for deployment.
4. Run `update.sh` and require every test/build/migration/health gate to pass.
5. Confirm the deployed commit, `intraday_momentum` `1.0.0`, fresh M15/H1 data, live broker environment, database integrity and zero quarantined positions.
6. If live entries were enabled before the update, restore them through `POST /api/trading/start` only after readiness passes.

If any broker position exists, stop and establish how its protective order and owner-run state will survive the release before deploying.

## Operations

```bash
./scripts/status.sh
./scripts/health-check.sh
./scripts/logs.sh runtime
./scripts/logs.sh trades
./scripts/backup.sh
```

The product contains one live runtime. The health check requires an active `intraday_momentum` run and, when trading is enabled, a passing live-readiness response.

### Backup safety

The daily backup is single-instance and keeps three verified source archives and SQLite snapshots by default. It writes `.partial` files, applies retention before and after copying, bounds SQLite copy and integrity-check runtime to 30 minutes, and publishes a snapshot only after `PRAGMA quick_check` returns `ok`.

For a database snapshot, the script pauses new entries and checks OANDA through the local account endpoint. It proceeds only with zero broker trades, briefly stops PM2 so the 2.8 GB database is quiet, then restarts the service and restores trading through the readiness-gated start endpoint before checking the immutable copy. An open broker trade or unavailable account state fails closed without stopping position monitoring. `--archive-only` creates only the source archive.

Useful overrides:

```bash
FOREX_BACKUP_RETENTION=3 ./scripts/backup.sh
FOREX_BACKUP_TIMEOUT_SECONDS=1800 ./scripts/backup.sh
./scripts/backup.sh --archive-only
```

An overlapping cron invocation exits without starting another copy. Deploy and update paths set `FOREX_BACKUP_REQUIRE_RUN=1`, so they fail instead of proceeding without a fresh backup.
