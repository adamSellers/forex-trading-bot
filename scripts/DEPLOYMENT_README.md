# Deploy

After publishing the reviewed changes to `main`, run this from your local checkout:

```bash
./scripts/deploy.sh
```

It connects to `adam@img.oakroad` and deploys to `/opt/forex-trading-bot`. The same command handles the first upgrade and subsequent releases: entry pause, broker/queue checks, staged dependency installation, tests and build, verified backup, migration, restart and operational health.

Previously enabled trading is restored through live readiness after success; a previously paused bot stays paused. Open positions, pending orders or unfinished entry work defer deployment while management continues. A readiness block leaves the deployed bot paused and is reported explicitly.

Open [the dashboard](http://fx.oakroad) afterward; no login is required on this private internal-network tool. After this upgrade, `./scripts/update.sh` is the equivalent command on the Pi.

See [recovery and access](../docs/operations/recovery-and-access.md) only for broker-credential recovery, backups or a failed rollout.
