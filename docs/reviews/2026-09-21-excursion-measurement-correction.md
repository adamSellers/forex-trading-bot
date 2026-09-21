# Excursion measurement correction — 21 September 2026

**Implemented and validated locally; not published or deployed.** The user requested the measurement correction first, followed by target evaluation and re-entry rule work. Production was last verified at `5c250a7`, `m15-intraday-v3.3` / strategy `1.1.3`. The separate [target and re-entry evaluation](2026-09-21-target-and-reentry-evaluation.md) specifies and measures candidates without changing live strategy settings.

## Observed problem

The [eight-day review](2026-09-21-eight-day-trading-review.md) found that 12 of 15 trades retained a final excursion observation after the broker's actual close, by 79–5,142 ms. Local management can still see a position while broker-close reconciliation is pending. Version 1 saved only running extrema, so it could not remove the effect of a late observation. An isolated reproduction through the real monitor persisted 2R of favorable excursion for a position already closed at its 1.5R target.

This proves contamination of the measurement window, not incorrect broker P&L or a duplicate entry. The review independently reconciled all 15 fills and closures. Historical maxima cannot be repaired reliably because the older payloads do not retain the individual observations.

## Change and contract

| Change | Reason and boundaries |
| --- | --- |
| Save version 2 reversible samples in the existing trade JSON payload | Each point is `[brokerEventAtMs, signedPips, signedROrNull]`. BUY uses executable exit bid; SELL uses ask. The existing original-stop distance supplies R. Repeated/older events and pre-entry events are excluded. No schema migration or parallel order subsystem is added. |
| Treat samples as provisional until authoritative closure | The same lifecycle queue that manages the trade serializes sample persistence. Refreshing its in-memory reference prevents an earlier queued object from overwriting newer reconciliation metadata. Write persistence before changing the in-memory payload. |
| Recompute at the shared close path | Once the matching broker trade has confirmed closure and completed accounting, retain only entry ≤ quote event ≤ broker close, recompute extrema/counts/times, and persist that result in the existing trade-close update. Record `excludedAfterClose`. Direct requested closes and external broker exits share this path. |
| Preserve authoritative close evidence through retries and restart | A matching fully closed trade or a matching full-close fill supplies `confirmedBrokerClosedAt`. Retain the evidence when cumulative accounting is missing or a later lookup fails. Partial fills and unrelated trade effects do not establish full-close time. |
| Keep accounting timestamp fallback separate | Existing `brokerClosedAt` fallback behavior remains for accounting. A local wall-clock fallback cannot verify excursion lifetime. Missing authoritative time yields `UNVERIFIED_CLOSE_TIME`; malformed v2 history yields `UNVERIFIED_HISTORY`, without preventing a valid broker/accounting close. |
| Preserve legacy observations explicitly | Unrecoverable v1 data is retained as legacy evidence. If an existing open position starts collecting v2 data, retain the old aggregate in `legacyAggregate`; do not mix it into new extrema. No historical rows are rewritten or assigned invented extrema. |
| Update shared analytics and dashboard coverage | Keep `measuredTrades` as the count with any saved observations. Add `verifiedTrades` and `unverifiedTrades`. R averages and finite-R denominators use only closed v2 records marked `VERIFIED` without partial legacy history. API and S3 analytics use this same calculation; the dashboard labels verified coverage and unverified samples explicitly. |

The broker event timestamp identifies when the sampled price occurred. Receipt time still determines availability for management, using the existing quote contract. A fresh successful response containing an older, unchanged broker price remains usable for existing management logic; it is not another independent excursion observation and does not become a health failure. This correction does not change quote availability, stop activation, entries, targets, risk sizing, cooldowns, exit scheduling or accounting.

`VERIFIED` means the retained sampled events lie inside the broker-confirmed lifetime at the application's existing millisecond precision. It does not mean tick-complete coverage, nanosecond ordering, a known price path between polls or a guaranteed executable fill at an observed quote. Null R remains unknown when original risk is unavailable. Observations at the exact millisecond close boundary are retained.

Samples remain in the payload after close for auditability. There is no arbitrary truncation that could erase an extremum needed during delayed reconciliation. Normal six-hour trades with ten-second monitoring produce roughly 2,160 points; payload size grows if a position or unresolved closure lasts longer. This is a small-account, one-position implementation, not a tick recorder.

This is a measurement-format correction (`sampledExcursion.version = 2`), not a behavioral trading release. Strategy/release/config identity and historical run attribution remain unchanged. Future strategy changes require their own behavioral release identity.

## Verification

**All 744 backend tests across 40 suites passed on Node 20.20.2 with the matching SQLite binding.** The initial sandboxed full run passed 734 tests; its ten API/Socket.IO tests could not open a loopback listener (`EPERM`). Those ten passed when rerun with permission to create the isolated local listener. No assertion failure remained.

Ten new lifecycle tests exercise real `OandaDataService` price normalization and `LiveTradingEngine` monitoring/closure with broker-shaped responses. Cases include:

- BUY and SELL observations beyond broker close, multiple late samples, delayed reconciliation and restart;
- unchanged broker event time with fresh receipt, including valid breakeven management and deduplicated measurement;
- inclusive close-time boundary and unchanged broker-realized P&L;
- failed database close writes followed by a successful retry, with one close event;
- missing authoritative close time, preserved full-close fill evidence, failed cumulative lookup, incomplete accounting and later timestamp omission;
- legacy history and a real temporary SQLite repository reloaded through `syncOpenTrades`.

Additional engine and reconciliation tests cover malformed series, timestamp parsing, partial/unrelated close effects and persisted close evidence. Analytics tests exercise mixed JSON/object payloads through the public aggregation path, legacy/provisional data, partial legacy coverage, null R, verified zero-R observations and closed/open distinctions. The changed frontend JSX parses successfully; `git diff --check` passes. Test broker calls, notifications and account services are isolated mocks; no manual orders or production database were used.

The old review's third [historical observation test](evidence/2026-09-21/reentry-review.test.js) intentionally asserts the defect on `5c250a7`; it is not a passing regression test for the corrected source. The new backend lifecycle suite is the regression contract.

## Delivery and remaining limits

Source and documentation are local only. User-managed Git publication, builds and the existing one-command deployment remain outstanding. No production source, process, runtime setting, account, trade or reporting schedule was changed. No frontend build was run under the repository's standing workflow.

After deployment, the first newly opened and broker-closed trade with v2 samples can establish production operation of the new format. Existing v1 closed trades remain unverified; a live upgrade of an already-open v1 trade retains partial legacy coverage and stays outside verified averages. Polling gaps and historical exact extrema remain unavailable. These limitations must carry into any later target or re-entry evaluation.
