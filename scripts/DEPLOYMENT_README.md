# Live deployment and recovery

Production is `/opt/forex-trading-bot` on `adam@img.oakroad`. Source changes go through the reviewed Git release. The user runs Git, build, deployment and production commands; the implementation pass does not execute them.

## Operator access contract

`FOREX_OPERATOR_TOKEN` is a separate operator credential: exactly 64 hexadecimal characters generated from 32 random bytes. Never reuse an OANDA/AWS/email credential. `scripts/setup-operator-access.sh` generates it, encrypts it into `.secrets/operator_token.enc` with `.keys/encryption.key`, and saves the owner-only browser access copy at `.keys/operator-access-token.txt`. It prints paths, not the token. Back up the key and credentials through a separately secured recovery channel.

The start wrapper loads the encrypted token before Node starts. When that encrypted file exists, it takes precedence over a stale PM2 environment token. Missing/invalid credentials prevent the production wrapper from starting; provision and verify them before stopping a working installation. Direct Node startup exposes an operator-setup-required 503 response rather than granting anonymous access.

- `GET /api/liveness` is a minimal public process probe. It says nothing about safe trading.
- `GET /api/auth/status` exposes only setup/sign-in state; unconfigured authentication returns 503.
- Browser sign-in is `POST /api/auth/login`, JSON `{ "token": "<operator token>" }`, from an allowlisted Origin. The dashboard supplies this form. It receives a random HttpOnly, SameSite=Strict session cookie, valid for eight hours; the credential is never saved in localStorage. Restart or token rotation invalidates sessions.
- All account, analytics, operational-health and control routes require authentication. `POST /api/auth/logout` revokes the session and its sockets. Socket.IO requires the same session or an API bearer token.
- Maintenance scripts source `load-operator-auth.sh` and call `forex_api_curl`. This loads the environment token or encrypted file and sends the bearer header through curl config on stdin, with a five-second connection deadline and twenty-second request deadline. No token goes into process arguments. Do not use shell tracing or add verbose/trace curl options around credentials.

`CORS_ALLOWED_ORIGINS`, falling back to `CORS_ORIGIN`, must contain the actual browser origins, comma separated. The current production browser address is `http://fx.oakroad`; retain that origin during bootstrap, and add `https://fx.oakroad` when TLS is configured. The checked-in PM2 configuration currently includes both. Login requires an explicit allowlisted Origin; session-cookie mutations reject missing or foreign origins. API bearer scripts can omit Origin. Production has no implicit origin allowlist. Development defaults include localhost ports 3100, 3101 and 5173.

Cookies become Secure on HTTPS automatically. Set `FOREX_AUTH_SECURE_COOKIE=true` after HTTPS works to reject plaintext browser login. The existing HTTP LAN proxy remains compatible during migration, but HTTP provides no transport confidentiality for login/session traffic. Use HTTPS and the intended firewall/network boundary before giving access beyond a trusted LAN. Express trusts forwarding headers only from loopback. The same-host reverse proxy must overwrite `Host`, `X-Forwarded-Proto` and client address headers, rather than trusting values sent by remote clients; forward WebSocket upgrades as well. For example, the proxy location uses `proxy_pass http://127.0.0.1:3101`, `proxy_set_header Host $host`, `proxy_set_header X-Forwarded-Proto $scheme`, and `proxy_set_header X-Forwarded-For $remote_addr`. TLS certificates remain outside Git and ordinary source archives.

## First rollout from the unauthenticated release

The current production release does not yet have these helper scripts. After committing/pushing the reviewed release locally, obtain the new maintenance tools without replacing the running checkout first. On the Pi, as `adam`:

```bash
cd /opt/forex-trading-bot
git fetch origin main
FOREX_ROLLOUT_TOOLS=$(mktemp -d)
git archive origin/main scripts | tar -x -C "$FOREX_ROLLOUT_TOOLS"
bash "$FOREX_ROLLOUT_TOOLS/scripts/setup-operator-access.sh"
source "$FOREX_ROLLOUT_TOOLS/scripts/load-node-runtime.sh"
source "$FOREX_ROLLOUT_TOOLS/scripts/load-operator-auth.sh"
```

If credentials were already provisioned, the setup script refuses replacement; inspect/reuse the existing credential instead. The old API ignores the additional Authorization header during this bootstrap. It remains unauthenticated until cutover, so keep it inside the existing trusted network boundary.

Inspect broker positions/pending orders and runtime state, then pause entries through the helper. Never close a live position just to deploy:

```bash
forex_api_curl http://localhost:3101/api/account
forex_api_curl http://localhost:3101/api/engine/status
forex_api_curl -X POST http://localhost:3101/api/trading/stop
bash "$FOREX_ROLLOUT_TOOLS/scripts/update.sh"
```

If any position, pending order, ambiguous intent or quarantine exists, defer cutover and resolve ownership/protection. The updated backup helper also reads the broker summary directly to verify zero pending orders; this does not depend on the old API exposing the new `pendingOrders` field. Helpers never send broker orders for validation.

Do not manually advance the checkout before invoking `update.sh`: the script uses its before/after commits to decide which dependency/test/build gates must run. The temporary-tools workflow above preserves that comparison. After rollout, verify the deployed commit, current versioned strategy, authenticated browser login, WebSocket updates, live reconciliation and operational health. Use the new `/api/system/health`, not only public liveness. The app must still be paused.

Only after the user chooses to restore the previous enabled state and all gates pass:

```bash
forex_api_curl http://localhost:3101/api/trading/live-readiness
forex_api_curl -X POST http://localhost:3101/api/trading/start
```

Delete the temporary tools when finished. Opening the owner-only access file in a trusted SSH/editor session lets the operator copy the token into the dashboard login; avoid shared terminal transcripts and browser extensions that record passwords.

## Later updates

Pause new entries, require flat broker state and resolve durable uncertainty, then run `./scripts/update.sh` from the production checkout. The script verifies clean tracked source, credentials and a durable pause; creates a verified backup; fast-forwards from the reviewed branch; installs lockfiles; runs backend tests and frontend build when relevant; migrates; restarts; and runs authenticated operational health. Pause, unresolved intents and direct broker flatness are checked again immediately before stopping for cutover. There is no `ALLOW_LIVE_DEPLOY` bypass. `deploy.sh` applies the same guards for a major existing-install repair. A new machine uses `first_time_setup.sh`, which provisions broker and operator credentials before starting. The historical destructive `forex-clean-install.sh` refuses any existing installation and delegates fresh setup only.

A failed preparation/migration/health gate is a failed deployment. Do not enable entries or assume rollback occurred. Inspect the process, source revision, backup and broker state. Scripts never hide a failed gate as a successful release.

For deliberate operator-token rotation, first pause and verify flat broker state using the current credential. Run `setup-operator-access.sh --rotate`, discard an old exported `FOREX_OPERATOR_TOKEN` in the operator shell, and perform the reviewed paused/flat restart so the wrapper loads the new encrypted credential. Sign in again. Do not rotate during an unresolved live incident: losing the previous working access path can obstruct recovery.

## Backups

The daily backup shares a nonblocking lock with restores, keeps three source archives and verified SQLite snapshots, uses bounded SQLite copy/integrity checks and atomic publication, and refuses to stop management while broker exposure or pending orders exist. It pauses new entries, requires a flat broker, briefly stops the process for the copy, and restores the previous enabled state through authenticated readiness. An open trade defers the DB copy; the separately created source archive can therefore have no matching snapshot. `--archive-only` also has no database snapshot. A full restore must never silently select some other newest DB.

```bash
./scripts/backup.sh
./scripts/backup.sh --archive-only
FOREX_BACKUP_RETENTION=3 ./scripts/backup.sh
```

Archives exclude `.env`, `.keys`, `.secrets`, TLS material and live SQLite/WAL files. They are **not** complete credential recovery. Store independently recoverable copies of verified SQLite snapshots, source release identity and protected credentials outside the Pi/root filesystem. Confirm storage access and perform an isolated restore drill; merely configuring S3 analytics does not establish full recovery or guarantee report delivery.

## Staged restore

Restore accepts an exact archive/snapshot path. An archive `forex_backup_TIMESTAMP.tar.gz` requires `trading_TIMESTAMP.db` in the same directory; no newest-file fallback is permitted. A `.db` restores database history into a staged copy of current source. Older pre-authentication source archives should use the database-only path with reviewed current code; source archives lacking the operator helper are rejected.

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

After explicit `RESTORE` confirmation, dependencies, frontend and schema are prepared only in staging. Source and database must validate before stopping the service. Broker/pause checks run again immediately before cutover. Staging and installation must share a filesystem for atomic directory moves. The entire original installation, database and secrets move to `/opt/forex-trading-bot.rollback.TIMESTAMP`; no original directory is deleted. The candidate is installed, starts **paused**, and must pass authenticated operational health. It never auto-enables live entries.

A failure after cutover stops the candidate and preserves the original rollback directory. It does not automatically restart either copy or resume entries. Keep both copies, inspect the exact failed step and verify broker truth. If restoring the original directory manually, ensure its config remains paused; move the failed candidate aside, move the preserved directory back, and run the appropriate reviewed migration/restart/health checks. Do not delete the rollback until recovery, credentials and history are independently verified. `RESTORE_MANIFEST.json` records the source/snapshot path and snapshot SHA-256; review the preserved Git context/diff before any later update of a restored historical source tree.

Loss of the entire installation requires recovering the encryption key and encrypted broker/operator credentials into a reviewed fresh checkout before this workflow. Do not generate a replacement key for existing encrypted secrets: it cannot decrypt the old credentials. `setup-operator-access.sh` refuses that condition.

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
node scripts/tests/frontend_refresh_contract.test.cjs
```

Restore tests stub npm, PM2, curl and locks; they perform no real deployments, broker requests or builds. A successful test is not a production restore drill. Build and deploy remain user-managed steps.
