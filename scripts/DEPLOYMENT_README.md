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
5. Confirm the deployed commit, `carry_trend` `1.0.0`, fresh H4/daily data, live broker environment, database integrity and zero quarantined positions.
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

The product contains one live runtime. The health check requires an active `carry_trend` run and, when trading is enabled, a passing live-readiness response.
