# Forex Trading Bot - Deployment Scripts

## Overview

These scripts manage the forex trading bot deployment on Raspberry Pi 5 (8GB).

**Current Port Allocation:**
| Service | Port |
|---------|------|
| Forex Backend | 3101 |
| Forex Frontend | 3100 |

Older bot instances, if still present on the same host, should stay on separate ports and are not managed by these scripts.

---

## Scripts Included

### Core Deployment

| Script                | Purpose             | When to Use               |
| --------------------- | ------------------- | ------------------------- |
| `first_time_setup.sh` | Fresh installation  | First deployment only     |
| `deploy.sh`           | Standard deployment | Feature updates, hotfixes |
| `update.sh`           | Quick code sync     | Minor changes only        |

### Operations

| Script            | Purpose                   |
| ----------------- | ------------------------- |
| `deploy-check.sh` | Shared-runtime preflight  |
| `backup.sh`       | Create timestamped backup |
| `restore.sh`      | Restore from backup       |
| `status.sh`       | System dashboard          |
| `health-check.sh` | Service health (for cron) |
| `logs.sh`         | Quick log access          |

### Security

| Script             | Purpose                                     |
| ------------------ | ------------------------------------------- |
| `setup-secrets.sh` | Encrypt Oanda credentials and optional email, S3, and TimesFM settings |
| `start-wrapper.sh` | Decrypt and inject secrets (PM2 calls this) |

---

## First Time Setup

SSH into your Pi and run:

```bash
# 1. Download the setup script (or clone repo first)
curl -O https://raw.githubusercontent.com/adamSellers/forex-trading-bot/main/scripts/first_time_setup.sh
chmod +x first_time_setup.sh

# 2. Run setup
./first_time_setup.sh
```

This will:

1. Clone the repository to `/opt/forex-trading-bot`
2. Install the pinned Node 22 dependencies from lockfiles and run the backend tests
3. Build the frontend
4. Run database migrations
5. Prompt for encrypted secrets: Oanda is required; email, S3, and TimesFM are optional
6. Start the service via PM2 with live trading paused

---

## Subsequent Deployments

For code updates after initial setup:

```bash
cd /opt/forex-trading-bot
./scripts/deploy.sh
```

For quick updates (the script only rebuilds the frontend when frontend files or dependencies changed):

```bash
cd /opt/forex-trading-bot
./scripts/update.sh
```

Pause live trading before running either command. Both scripts refuse a live
rollout, preserve tracked local work, create a verified backup, fast-forward the
Git branch, install from lockfiles, run tests/builds before cutover, migrate, and
require the comprehensive health check to pass. Every backend process start also
forces live trading back to paused; enabling it is a separate operator action
after post-deploy checks.

The supported production runtime is pinned by `.nvmrc` to Node 22.16.0. Install
that version under nvm before first setup; the scripts reject unsupported or
wrong-architecture Node binaries.

Both `deploy.sh` and `update.sh` run `npm run db:migrate` before restarting services.
The current March 2026 migration set includes the shared-runtime identity columns
and the Phase 5 cleanup that drops the retired `backtest_results` table.
If you still need any historical offline backtest rows, export them before running
`deploy.sh` or `update.sh`.

### Phase 6 Shared Runtime Rollout

Follow the Phase 6 packet order exactly:

1. Run the local frontend build manually first:
   ```bash
   cd frontend && npm run build
   ```
2. Optionally run the shared-runtime preflight:
   ```bash
   ./scripts/deploy-check.sh
   ```
3. Export `backtest_results` first if any old research rows still matter:
   `006_drop_backtest_results.js` removes that retired table during migration
4. Deploy with `deploy.sh` for the first runtime rollout or when you want the full install path
5. Use `update.sh` only for follow-up pushes once the shared-runtime rollout is already established
6. Run the runtime QA and monitoring checklist in [`PHASE6_ROLLOUT_CHECKLIST.md`](./PHASE6_ROLLOUT_CHECKLIST.md)

### Replay and Runtime Comparison Workflow

The production strategy stack now has two complementary validation paths:

1. Run deterministic, chronology-safe historical replay with `cd backend && npm run replay -- --help`
2. Use purged walk-forward validation and the append-only experiment registry for research decisions
3. Open the `Paper` view to inspect the active shadow baseline and candidate runs under current market data
4. Open `Analytics` and filter by `mode`, `strategy`, `runId`, or `selectionId`; all monetary results use AUD as the reporting currency
5. Promote only through `POST /api/runtime/runs/:runId/promote` after the sample-size, confidence-bound, drawdown, cost, concentration, shadow-match, and parity gates pass

The legacy `/api/backtest` routes remain retired. The replay CLI uses the shared
execution, sizing, exit, cost, and strict AUD-conversion policies instead of the
old backtest implementation.

---

## Daily Operations

### Check Status

```bash
./scripts/status.sh
# or
pm2 status
```

### View Logs

```bash
./scripts/logs.sh          # Last 50 lines
./scripts/logs.sh tail     # Follow live
./scripts/logs.sh trades   # Filter trade activity
./scripts/logs.sh runtime  # Filter runtime/shadow/candidate activity
./scripts/logs.sh errors   # Filter errors
```

### Manual Backup

```bash
./scripts/backup.sh        # Hot backup (service running)
./scripts/backup.sh --cold # Cold backup (stops service)
```

Backups default to `$HOME/forex-trading-bot-backups`, retain the newest five
sets (override with `FOREX_BACKUP_DIR` and `FOREX_BACKUP_RETENTION`), exclude
credentials and keys, and verify both the compressed archive and SQLite snapshot.

### Restore from Backup

```bash
./scripts/restore.sh
# Interactive menu to select backup
```

---

## Automated Health Checks (Cron)

Add to crontab (`crontab -e`):

```cron
# Health check every 5 minutes
*/5 * * * * /opt/forex-trading-bot/scripts/health-check.sh >> /opt/forex-trading-bot/backend/logs/cron.log 2>&1

# Daily backup at 2 AM
0 2 * * * /opt/forex-trading-bot/scripts/backup.sh >> /home/adam/forex-trading-bot-backups/backup.log 2>&1
```

---

## Oanda Credentials

Credentials are stored encrypted in:

-   `/opt/forex-trading-bot/.secrets/oanda_api_key.enc`
-   `/opt/forex-trading-bot/.secrets/oanda_account_id.enc`

To update credentials:

```bash
./scripts/setup-secrets.sh
pm2 restart forex-backend
```

---

## Troubleshooting

### Service won't start

```bash
pm2 logs forex-backend --lines 50
# Check for missing dependencies or config errors
```

### API not responding

```bash
curl http://localhost:3101/api/health
./scripts/health-check.sh
```

### TimesFM sidecar

The bot can enrich actionable signals through the Mac-hosted TimesFM sidecar, and the native `timesfm_directional` strategy depends on the same sidecar for forecast-led entries.

1. Deploy the Python service from [`timesfm-sidecar/`](../timesfm-sidecar/README.md) on Lathe
2. Store `TIMESFM_URL` and `TIMESFM_KEY` on the Pi via `./scripts/setup-secrets.sh`
3. Restart the backend:

```bash
pm2 restart forex-backend
```

Verification endpoints:

```bash
curl http://localhost:3101/api/system/health
curl http://localhost:3101/api/engine/status
curl http://localhost:3101/api/strategies/catalog
```

Operational note: overlay enrichment fails open when TimesFM is unavailable. The native `timesfm_directional` strategy emits HOLD until a usable forecast is available.

### Database issues

```bash
sqlite3 /opt/forex-trading-bot/backend/data/trading.db ".tables"
sqlite3 /opt/forex-trading-bot/backend/data/trading.db "SELECT COUNT(*) FROM trades;"
```

To confirm migrations were applied:

```bash
cd /opt/forex-trading-bot/backend
npm run db:migrate
sqlite3 data/trading.db "PRAGMA table_info(signals);"
sqlite3 data/trading.db "PRAGMA table_info(trades);"
```

### Oanda connection errors

```bash
# Verify credentials are set
cat /opt/forex-trading-bot/.secrets/oanda_api_key.enc
# (should show encrypted binary data)

# Test decryption manually
./scripts/start-wrapper.sh
# Should show "Secrets decrypted and loaded"
```

### Full reset (nuclear option)

```bash
pm2 delete forex-backend
sudo rm -rf /opt/forex-trading-bot
./first_time_setup.sh
```

---

## Files NOT Needed (Removed from Legacy Bot)

These scripts were specific to the prior bot setup and have been removed:

-   `clean-install.sh` - Redundant with `first_time_setup.sh`
-   `deploy_crypti.sh` - Legacy deploy script
-   `dev-setup.sh` - Different development environment
-   `rollback.sh` - Replaced by `restore.sh`
-   `monitor.sh` - Merged into `status.sh`
-   `collect_logs.sh` - Legacy path assumptions

---

## Quick Reference

```bash
# Start/Stop
pm2 start forex-backend
pm2 stop forex-backend
pm2 restart forex-backend

# Logs
pm2 logs forex-backend
pm2 logs forex-backend --lines 100 --nostream

# Status
pm2 status
pm2 monit

# Process status
pm2 status
pm2 restart all
```
