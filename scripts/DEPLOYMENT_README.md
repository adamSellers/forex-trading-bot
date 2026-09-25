# Deploy

Develop and commit locally, publish to GitHub, then deploy from GitHub to the bot. The bot only consumes published source; never commit, push or make source hotfixes on it.

**Last verified deployment: September 26, 2026.** Read-only inspection confirmed clean revision `5889b66`, including the excursion measurement correction, with release `m15-intraday-v3.3` / strategy `1.1.3` and the existing run/config unchanged. The subsequently authorized [integrated v4 release](../docs/reviews/2026-09-26-integrated-release-specification.md) is implemented and validated locally, but has not been published or deployed. The [current status and decisions](../docs/reviews/2026-09-26-status-and-decisions.md) distinguish these states. Git publication, builds and deployment remain user-managed through the same command below; saved enabled intent/settings and active cooldown deadlines are preserved.

After publishing the reviewed changes to `main`, run this from your local checkout:

```bash
./scripts/deploy.sh
```

It connects to `adam@img.oakroad` and deploys to `/opt/forex-trading-bot`. The same command handles the first upgrade and subsequent releases: entry pause, broker/queue checks, staged dependency installation, tests and build, verified backup, migration, restart and operational health.

Previously enabled trading is restored after success, with any active loss cooldown still enforced; a previously paused bot stays paused. Open positions, pending orders or unfinished entry work defer deployment while management continues. Other readiness failures leave the deployed bot paused and are reported explicitly.

Open [the dashboard](http://fx.oakroad) afterward; no login is required on this private internal-network tool. `./scripts/update.sh` is the equivalent command on the Pi.

See [recovery and access](../docs/operations/recovery-and-access.md) only for broker-credential recovery, backups or a failed rollout.
