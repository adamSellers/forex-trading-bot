# Phase 6 Rollout Checklist

This packet is limited to Phase 6 only:

- Rollout and monitoring only
- Preserve the Phase 2 live runtime and `ownerRunId` ownership behavior
- Keep candidate runs in `paper_candidate` unless a dedicated promotion step explicitly creates a new live selection
- Continue reporting from the unified runtime identity columns
- Do not reintroduce any legacy lab/backtest production path

## Packet Order

### 0. Local Preflight

Run the frontend build manually before any rollout work:

```bash
cd frontend && npm run build
```

Optional shared-runtime preflight:

```bash
./scripts/deploy-check.sh
```

If historical `backtest_results` rows still matter, export them before the rollout.
Migration `006_drop_backtest_results.js` drops that retired table.

```bash
cd /opt/forex-trading-bot/backend
sqlite3 data/trading.db ".headers on" ".mode csv" ".once /tmp/backtest_results_export.csv" "SELECT * FROM backtest_results;"
```

### OPS-02 Deploy The Shared Runtime Stack

Use `deploy.sh` for the first Phase 6 rollout, any migration-sensitive change, or when
you want the full reinstall path:

```bash
ssh img.oakroad
cd /opt/forex-trading-bot
./scripts/deploy.sh
```

Use `update.sh` only for follow-up pushes after the Phase 6 rollout is already in place.
It is still allowed to rebuild the frontend if frontend files or dependencies changed.

```bash
ssh img.oakroad
cd /opt/forex-trading-bot
./scripts/update.sh
```

Expected rollout effects:

- `npm run db:migrate` applies the shared runtime identity migration set
- `006_drop_backtest_results.js` drops the retired `backtest_results` table
- PM2 restarts the shared runtime stack on port `3101`

### OPS-03 Verify The Runtime-Only Workflow

Confirm the active live selection and paired shadow run:

```bash
curl -s http://localhost:3101/api/runtime/live-selection | python3 -m json.tool
```

Expected:

- `liveSelection.liveRun.mode` is `live`
- `liveSelection.shadowRun.mode` is `paper_shadow`
- `liveSelection.shadowRun.shadowOfRunId` matches `liveSelection.liveRun.runId`
- `liveSelection.selectionId` is present

Confirm the runtime registry:

```bash
curl -s http://localhost:3101/api/runtime/runs | python3 -m json.tool
```

Expected:

- Exactly one active `live` run
- Exactly one active `paper_shadow` run for the active live selection
- Older live runs may appear as `managing_only` if they still own open trades
- Candidate runs appear only as `paper_candidate`
- The strategy catalog includes `correlation_divergence` as a candidate-only strategy with `supportsLive=false`

Verify that live strategy changes affect new entries only:

1. Change the active live strategy from the Dashboard UI.
2. Re-run the live-selection and runtime-runs checks above.
3. Inspect recent live trades:

```bash
cd /opt/forex-trading-bot/backend
sqlite3 data/trading.db "SELECT id, instrument, is_open, mode, run_id, owner_run_id, selection_id, strategy, entry_time, exit_time FROM trades WHERE mode = 'live' ORDER BY entry_time DESC LIMIT 30;"
```

Expected:

- The active live `run_id` changes after the selection update
- New live entries use the new `run_id`
- Existing open live trades keep their original `owner_run_id`
- Previous live runs remain `managing_only` until their open positions close

Verify the paired shadow baseline and candidate paper isolation:

1. Open the `Paper` view.
2. Confirm the active shadow run is present for the active live strategy.
3. Start or inspect a candidate run from the Paper view.
4. Confirm candidate rows remain paper-mode unless deliberately promoted:

```bash
cd /opt/forex-trading-bot/backend
sqlite3 data/trading.db "SELECT run_id, mode, strategy, status, selection_id, shadow_of_run_id, started_at, stopped_at FROM strategy_runs ORDER BY started_at DESC LIMIT 20;"
sqlite3 data/trading.db "SELECT mode, COUNT(*) AS trade_count FROM trades GROUP BY mode ORDER BY mode;"
```

Expected:

- The shadow baseline stays in `paper_shadow`
- Candidate runs stay in `paper_candidate`
- Launch, stop, and reset candidate actions do not write `mode = 'live'`
- No separate paper-only reporting tables are introduced

Verify candidate promotion separately before using it operationally:

1. Choose a reviewed active `paper_candidate` run in the Paper view.
2. Confirm the strategy metadata allows live support:
   ```bash
   curl -s http://localhost:3101/api/strategies/catalog | python3 -m json.tool
   ```
3. Promote only when comfortable with the cutover behavior:
   ```bash
   curl -s -X POST http://localhost:3101/api/runtime/runs/<candidateRunId>/promote | python3 -m json.tool
   ```

Expected:

- The response includes a new `liveSelection`
- The promoted source run remains `paper_candidate` and receives promotion metadata
- A new `live` run and paired `paper_shadow` run are created from the candidate config snapshot
- Any live-position liquidation is explicit in the response payload
- Paper-only candidates such as `correlation_divergence` should be rejected or hidden from promotion controls

Verify analytics and reporting still use the unified runtime identity columns:

```bash
curl -s "http://localhost:3101/api/analytics?period=7d&mode=live" | python3 -m json.tool
curl -s "http://localhost:3101/api/analytics?period=7d&mode=paper_shadow" | python3 -m json.tool
curl -s "http://localhost:3101/api/analytics?period=7d&mode=paper_candidate" | python3 -m json.tool
```

Optional run-specific checks:

```bash
curl -s "http://localhost:3101/api/runtime/runs/<runId>/trades" | python3 -m json.tool
curl -s "http://localhost:3101/api/runtime/runs/<runId>/signals" | python3 -m json.tool
curl -s "http://localhost:3101/api/runtime/runs/<runId>/equity" | python3 -m json.tool
```

Expected:

- `Analytics` UI filters work by `mode`, `strategy`, `runId`, and `selectionId`
- Run detail APIs return data from the shared runtime tables
- Reporting continues from `strategy_runs`, `trades`, `signals`, `entry_decisions`, and `portfolio_snapshots`

Do not use or restore:

- `/api/backtest`
- `scripts/backtest.js`
- `scripts/backtestSweep.js`
- any legacy lab/offline comparison workflow

### OPS-04 Monitor The First Live Comparison Window

Use the shared-runtime monitoring scripts during the first live comparison window:

```bash
cd /opt/forex-trading-bot
./scripts/status.sh
./scripts/health-check.sh
./scripts/logs.sh runtime
./scripts/logs.sh errors
pm2 status
pm2 logs forex-backend --lines 100 --nostream
```

Recommended checks during the window:

- Watch for a valid live selection and paired shadow run after restarts
- Watch for `managing_only` live runs to drain naturally as old positions close
- Confirm candidate paper runs remain isolated from live mode
- Confirm analytics filters continue to resolve by unified runtime identity
- Watch memory usage and API health on the shared runtime stack

### Phase 6 Checkpoint

Stop at the Phase 6 checkpoint once:

- The rollout command has completed successfully
- The runtime QA checks above pass
- The first monitoring window shows stable live, shadow, candidate, and analytics behavior

If rollout observations or follow-up fixes are needed after that checkpoint, start a new thread.
