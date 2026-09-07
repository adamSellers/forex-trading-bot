# September 7 — Startup timeout and locale incident

Status: **correction deployed by the user at `788a725`; verified healthy by read-only SSH at 13:56 AEST on September 7**. The user had deployed commit `8d45be3` before the original investigation below. The running release remains `m15-intraday-v3`, strategy `1.1.0`, with direct API access and no operator login requirement.

## Production evidence

At **08:09:32 AEST on September 7** (22:09:32 UTC on September 6), operational health was healthy, readiness passed, all four price feeds and eight M15/H1 candle sets were fresh, entries were enabled, and there were zero open positions, unresolved intents or uncertain broker state. Uptime was 886 seconds. The latest candle error remained 07:55:24. PM2 earlier reported the process online with zero unstable restarts; the recorded shutdowns used graceful SIGINT. These errors did not establish an ongoing crash loop.

The latest affected restart shows the collision:

| AEST time | Evidence |
| --- | --- |
| 07:54:47 | API and data service start |
| 07:54:49 | Initial data fetch finishes; polling starts |
| 07:54:51 | Deployment health finds an incomplete runtime but nevertheless starts SQLite integrity verification |
| 07:54:54.538 | Retention finishes its deletes and starts a synchronous `wal_checkpoint(TRUNCATE)` through the live Knex/better-sqlite3 connection |
| 07:55:24.566 | Checkpoint returns busy after the connection's 30-second busy timeout |
| 07:55:24.574 | In-flight AUD_USD candle request reports an abort as the Node event loop resumes |
| 07:55:47 | Health script's database scan finally finishes |

The **07:42:33.971 → 07:43:04.016** checkpoint stall and **07:43:04.023** candle abort show the same sequence. The database occupied 2,973,777,920 bytes; its WAL was approximately 1.36 MB during inspection. The health scan's long-lived reader explains why the truncating checkpoint could not finish. The synchronous driver prevented Node from processing network responses, timers and management work while it waited. The production timestamps and the real lock-contention regression support this diagnosis; the investigation did not inject faults into production.

The locale warning is separate: PM2 configured `LANG` and `LC_ALL` as `en_AU.UTF-8`, but `locale -a` returned only `C`, `C.utf8`, `POSIX` and `en_GB.utf8`. A read-only subprocess using `C.UTF-8` returned `UTF-8` without the warning. Explicit IANA trading-session time zones are independent of this process locale.

The older OANDA 503 explicitly reports upstream maintenance, and the earlier generic price-fetch failure is historical. They are not authentication failures. The successful secrets-loading message is written to stderr by the wrapper, so its appearance in PM2's error log does not indicate failure. Existing S3 credentials remain incomplete, as previously documented; the incident patch does not provision them.

## Changes and justification

- **Background checkpoint:** the live retention function delegates TRUNCATE to a short-lived child Node process using the existing resolved database path and its own SQLite connection. It refuses missing files, receives no broker/email/AWS credentials, does not wait on a busy lock by default, and has a five-second process deadline with forced termination. Concurrent requests for the same path share one child. Shutdown kills active children; completion, contention, cancellation and failure are distinguished. Ordinary WAL checkpointing remains enabled and trade history is preserved.
- **Health-check sequencing:** an unready/degraded runtime fails immediately and defers the expensive database scan. Once ready, the full read-only integrity/lifecycle phase remains mandatory and is bounded to 60 seconds. Malformed/nonfinite health timestamps fail. This removes the startup collision without making a failed health gate pass.
- **Timeout diagnostics:** candle failures now include the instrument and M15/H1 timeframe. A local deadline failure says the request exceeded its 10,000 ms deadline, while HTTP 503 retains the broker's error. Polling cadence, the request deadline and entry freshness requirements are unchanged.
- **Locale:** PM2 uses the verified `C.UTF-8` locale. No host locale packages or machine settings were changed.

SQLite documents that truncating checkpoints can wait for readers and writers; a separate process prevents that native wait from directly freezing the trading event loop. SQLite writer-lock contention and disk I/O can still occur, which is why the child also has a zero-wait default and a bounded total lifetime. See [SQLite checkpoint semantics](https://www.sqlite.org/c3ref/wal_checkpoint_v2.html) and [Node asynchronous child processes](https://nodejs.org/api/child_process.html#asynchronous-process-creation).

## Verification and delivery

Real temporary WAL tests hold a read transaction while checkpointing, verify that the main event-loop timer still fires, then release the reader and confirm successful truncation, preserved rows and SQLite integrity. Additional cases cover overlapping calls, a hung child, shutdown cancellation, a missing DB and invalid/busy results. Actual server wiring tests exercise retention delegation and API responsiveness. All database fixtures are isolated from production.

**Final local verification:** 510/510 backend tests pass across 33 suites on Node 20.20.2, including 10 real child/checkpoint tests, 8 server integration tests and 29 data-service tests. All 17 health-check scenarios and 26 deployment/startup/maintenance scenarios pass. Nine changed/new JavaScript files and two shell files pass syntax checks; `git diff --check` passes. The first full run exposed an existing native-SQLite/Jest cross-realm error assertion: the duplicate-ID insert was correctly rejected, but `toThrow` did not recognize its error object. The test now checks `SQLITE_CONSTRAINT_UNIQUE`, the column name and one retained row; production repository behavior was not changed. A forced checkpoint-first test order also passes. No production source, configuration, service, trading state, broker order or credential was changed by the agent. This maintenance/diagnostic patch does not change the trading strategy or cohort identity.

**Subsequent deployment verification:** after the user's deployment, read-only SSH at 13:56:50 AEST verified production commit `788a725`, more than five hours of runtime uptime, healthy operational state, all four price feeds and eight candle sets fresh, and zero open positions, unresolved intents or uncertain broker state. No further data-fetch errors were recorded after the pre-correction 07:55:24 candle abort. This observation supports the startup correction; it is not a guarantee against future broker/network failures. Repeated health-warning/recovery emails were a separate notification-design problem, recorded in the [email-removal follow-up](2026-09-07-operational-email-removal.md).
