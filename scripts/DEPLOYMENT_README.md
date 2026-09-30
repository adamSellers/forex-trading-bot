# Deploy

Develop and commit locally, publish to GitHub, then deploy from GitHub to the bot. The bot only consumes published source; never commit, push or make source hotfixes on it.

**September 30:** read-only inspection verified clean deployed v4.1 at `6722838`. The user explicitly authorized publication/build/deployment of the [v4.2 H1 reset release](../docs/reviews/2026-09-30-loss-reset-release.md) through the command below. Its release record separates local validation, publication and verified production delivery. Saved enabled intent/settings and active cooldown deadlines are preserved. This specific authorization supersedes the earlier user-managed restriction for this release.

After publishing the reviewed changes to `main`, run this from your local checkout:

```bash
./scripts/deploy.sh
```

It connects to `adam@img.oakroad` and deploys to `/opt/forex-trading-bot`. The same command handles the first upgrade and subsequent releases: entry pause, broker/queue checks, staged dependency installation, tests and build, verified backup, migration, restart and operational health.

Previously enabled trading is restored after success, with any active loss cooldown still enforced; a previously paused bot stays paused. Open positions, pending orders or unfinished entry work defer deployment while management continues. Other readiness failures leave the deployed bot paused and are reported explicitly.

Open [the dashboard](http://fx.oakroad) afterward; no login is required on this private internal-network tool. `./scripts/update.sh` is the equivalent command on the Pi.

See [recovery and access](../docs/operations/recovery-and-access.md) only for broker-credential recovery, backups or a failed rollout.
