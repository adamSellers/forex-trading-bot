**Forex trading bot — end-to-end production review**

**Reviewed 6 September 2026, approximately 18:50–19:10 Australia/Sydney.** Source and production commit: `bee8527` (`removing the trading block`). Production: `adam@img.oakroad:/opt/forex-trading-bot`. Current dashboard: [fx.oakroad](http://fx.oakroad).

**Assessment: the bot is not yet a reliably profitable system, and its live behavior does not fully implement the strategy described in the release documentation.** The most valuable next work is to correct execution and exit behavior, make failures visible, and then collect a clean, versioned live sample. Increasing capital or tuning indicators now would mix an unproven strategy with known implementation defects.

This was a read-only first pass. No source, runtime configuration, broker orders, trading enable state, production processes, deployment, or Git history was changed. The report is outside the repository. Local tests and isolated behavioral reproductions used mocks or temporary storage. Both source checkouts remained clean.

**1. What is actually running**

| Item | Observed state |
| --- | --- |
| Release | `m15-intraday-v2` / `intraday-risk-v2` |
| Strategy | `intraday_momentum` `1.0.0` |
| Live run | `live_f5fd0dc4-e049-45ea-be0f-6f48e4cf9dfd` |
| Config hash | `e1e9ab40c947df220250` |
| Trading | Enabled; engine and strategy loop running |
| Broker account | Live OANDA, AUD |
| Balance and NAV | A$96.7558 |
| Broker trades / pending orders | 0 / 0 |
| Local positions / quarantines | 0 / 0 |
| Durable entry intents | 17 completed; none unresolved |
| Risk state | Ready, two consecutive losses; three losses trigger the configured cooldown |
| Persisted NAV high watermark | A$97.1603; current drawdown approximately 0.42% |
| Production runtime | Node 22.16.0, PM2 process online, about 186 MiB RAM |
| Process restarts | Zero crash restarts in the current PM2 lifetime; daily backup intentionally stops/restarts while flat |
| Host resources | Root filesystem 48% used, approximately 29 GB free; approximately 6.45 GB available memory; no swap used |
| Market state | Weekend, OANDA quotes non-tradeable; no live entry/exit was observed during this review |

The September 2 cooldown release is deployed even though PROJECT_HISTORY still labels it “not yet deployed.” The earlier permanent three-loss halt affected the v1 run: 26 entry decisions were rejected for `CONSECUTIVE_LOSS_LIMIT`. The v2 run no longer shows that permanent block.

The current README, USER_GUIDE, August 10 release note and roadmap establish the relevant constraints: one live strategy, one live entry runtime, no simulated execution subsystem, no manual test orders, small risk and real broker outcomes as evidence. CLAUDE.md contains substantially older architectural instructions; its source/build/deployment restrictions were respected, but its retired strategy architecture was not treated as the current specification.

**2. Profitability: broker-verified results**

I retrieved OANDA closed-trade records directly and compared all 17 M15 trades with SQLite. All 17 matched on closing price and net realized P&L including financing. Each returned broker trade record contained a stop-loss order. That supports the recorded trade results; it does not prove continuous protection throughout every possible outage.

| Cohort | Closed | Wins / losses / flat | Net AUD | Profit factor | Mean net R |
| --- | ---: | --- | ---: | ---: | ---: |
| M15 v1, August 10–September 2 run | 12 | 3 / 6 / 3 | −0.1667 | 0.84 | −0.071 |
| M15 v2, September 2 onward | 5 | 2 / 2 / 1 | +0.1829 | 1.47 | +0.188 |
| Both M15 releases | 17 | 5 / 8 / 4 | **+0.0162** | **1.01** | **+0.005** |

The combined result is approximately **1.6 cents profit**, or **0.095 cents per trade**. It is economically indistinguishable from flat at this sample size. The five-trade v2 result is encouraging only in the narrow sense that it is positive; it is not evidence that the cooldown change created an edge.

R here is net AUD P&L divided by reconstructed initial stop risk: absolute units × persisted initial stop distance × entry quote-to-AUD risk conversion. Observed initial risk was A$0.1939–A$0.1956 per trade. Net trade results already reflect executable entry/exit prices and recorded financing; spread should not be subtracted again from those net figures.

The sample standard deviation is approximately 1.06R. An illustrative 95% Student-t interval for mean R is roughly **−0.54R to +0.55R**, assuming independent trades. That assumption is optimistic for correlated currencies and clustered market conditions, and the releases differ. The point is the scale of uncertainty, not a precise statistical certification. The documented 30-trade checkpoint is an operational review threshold, not proof of profitability.

The headline “0.25% NAV” sizing rule is also imprecise. Actual sizing risks 0.25% of `min(80% available margin, A$100)`, resulting in approximately 0.20% NAV while the account is flat near A$100. This is conservative, but expected returns must use actual risk. Even a hypothetical, established 0.1R edge at ten trades a week and A$0.195 risk would yield about A$0.195 a week before operating costs. The present account is useful for validating behavior and evidence, rather than generating meaningful income. [Sizing implementation](../../backend/src/runtime/executionPolicy.js#L215)

OANDA reports historical realized P&L of **−A$52.1161** and financing of **−A$1.1281**, separately. These cover prior strategies and must not be attributed to M15. SQLite contains 117 historical live trades totaling −A$50.8652 net, so its retained historical dataset is not a complete account-wide accounting reconciliation. The current M15 cohort is reconciled; the older residual difference was not reconstructed transaction by transaction in this pass.

**3. The entry funnel explains more than the trade count**

| Actionable entry outcome | M15 v1 | M15 v2 |
| --- | ---: | ---: |
| Filled | 12 | 5 |
| Already holding the pair | 5 | 2 |
| One-position limit | 7 | 6 |
| Three-loss risk rejection | 26 | 0 |
| Final-quote movement rejection, mislabeled submission failure | 20 | 9 |
| Spread rejection | 5 | 1 |
| **Total actionable entry decisions** | **75** | **23** |

All 29 `ORDER_SUBMIT_FAILED` decisions say the final quote exceeded the 1.5-pip movement limit. They are pre-submission rejections, not evidence of 29 failed broker orders. Seven of the nine v2 examples are AUD/USD, generally reported as 4.2–4.8 pips of movement. No AUD/USD or GBP/USD trade has filled in the M15 cohort.

This matters because the intended four-pair experiment is effectively a two-pair filled sample. A guard using the wrong quote source is a more immediate explanation to investigate than weakening the ADX or RSI filters.

At the current-run query, 25,124 signal polls included 23 actionable events. Outside-session, neutral regime and candle-quality decisions dominated the repeated HOLD observations. Weekend polling repeatedly evaluates the same final candles; raw poll counts are not independent opportunities. Future funnel reports should count each completed pair/candle once, preserve within-candle changes separately, and separate closed-market time, paused time and eligible trading time. Reason-code counts also reflect the order of gates, not independent marginal effects of each filter.

The cost gate itself is restrictive by design: with a six-pip stop and 0.2-pip slippage assumption, spread must be at most 0.7 pip to meet the 15% limit. At a one-pip spread the stop must be at least eight pips. A quiet-session rejection is therefore not automatically a defect.

**4. High-priority findings**

P1 below means address before increasing risk or treating subsequent live results as a faithful test of the documented strategy. “Observed” indicates production evidence; “latent” indicates a confirmed code failure scenario without an observed current incident.

**F1 — P1, observed: six-hour and pre-rollover exits never run.**

The helper `resolveTimedExitReason()` implements the time and New York closure rules, but has no production call site. `checkPosition()` only retries pending closes/stops and updates breakeven/trailing stops. The helper has isolated unit tests, which do not establish that the engine actually invokes it. An in-memory reproduction with a seven-hour position returned `TIME_STOP` from the helper but caused zero exit calls through the real monitoring method. [Exit helper](../../backend/src/runtime/exitPolicy.js#L234), [live monitor](../../backend/src/services/LiveTradingEngine.js#L3167)

Production trade **2962**, EUR/USD BUY, opened August 19 at 19:30:45 UTC and closed August 20 at 07:27:46 UTC: **11h57m**. It crossed the intended 16:45 New York exit window and incurred **A$0.0499 financing**. Its broker exit was a breakeven stop, yet net P&L was −A$0.0520. This is a direct mismatch between the intended intraday experiment and the actual strategy being traded.

Correction direction: invoke owner-run timed exits from position management, independently of entry generation; retry and reconcile broker closure; test the actual monitor across restart, missing prices, the six-hour boundary and DST. When connecting rollover exits, also block conflicting entries: Sydney entry hours overlap the New York closure window during parts of Australian daylight saving. Otherwise a newly opened AUD trade can become immediately eligible for closure.

**F2 — P1, observed: entry validation uses OANDA closeout prices instead of entry liquidity.**

`getFinalEntryQuote()` chooses `closeoutBid`/`closeoutAsk` before ordinary bids/asks. OANDA defines closeout prices as fallback closing prices when the corresponding liquidity is unavailable, and explicitly excludes them from opening positions. [Entry quote selection](../../backend/src/services/LiveTradingEngine.js#L1804), [OANDA pricing specification](https://developer.oanda.com/rest-live-v20/pricing-df/)

One stored USD/JPY SELL illustrates the error: selected final quote **155.348**, ordinary bid **155.358**, actual fill **155.358**. One pip of the measured “movement” was a quote-source difference. EUR/USD examples similarly show about one pip between selected closeout ask and ordinary ask/fill. Current closed-market AUD/USD pricing also shows a roughly four-pip closeout offset beyond the ordinary bid/ask; that weekend snapshot is explanatory, not a reconstruction of weekday rejected orders.

The wrong reference affects three things: false deviation rejections, initial SL/TP anchoring, and the broker `priceBound`. Initial protection is subsequently realigned to actual fill when the modification succeeds. Exact attribution of each rejected order requires its contemporaneous ordinary quote, which is not retained when rejection happens before intent creation. The systematic AUD/USD rejection pattern is strongly consistent with this defect, but “all 29 would otherwise have filled” is not established.

Correction direction: use ordinary ask liquidity for BUY and bid liquidity for SELL, sized to the requested units, and retain the existing movement guard against a clearly defined executable reference. Recompute spread, age and cost/stop ratio from the same final quote. Do not widen the 1.5-pip limit to compensate for a wrong price source. OANDA defines `priceBound` as the worst permitted fill price. [Order specification](https://developer.oanda.com/rest-live-v20/order-df/)

**F3 — P1, latent: unknown broker exposure can escape background reconciliation and the one-position limit.**

`monitorPositions()` returns immediately when the local open-trade map is empty. If the first market order fills at OANDA but its response is lost, the local map can remain empty and periodic reconciliation never runs. Durable ambiguity is recorded, but unresolved intents do not reserve capacity for future entries. A quarantine also blocks only its own instrument. [Early return](../../backend/src/services/LiveTradingEngine.js#L3133), [entry position checks](../../backend/src/services/LiveTradingEngine.js#L953), [ambiguous submission path](../../backend/src/services/LiveTradingEngine.js#L2685)

Isolated reproductions confirmed zero broker synchronization calls while locally flat, and acceptance of AUD/USD by the position-count checks while an EUR/USD broker quarantine existed under a one-position cap. Other risk gates may still reject some such entries, but the account-wide one-position invariant is not enforced by this path.

Correction direction: reconcile broker state even when locally flat, serialize reconciliation, reserve risk/capacity for unresolved intents, and halt all new entries while broker exposure is uncertain. Test timeout → broker fill → next queued pair → recovery without a manual sync or process restart. Production currently has 17 completed intents and no quarantine, so there is no present unknown-exposure incident.

**F4 — P1, latent: protective-order confirmation and retry are incomplete.**

A failed initial fill-alignment modification stores desired SL/TP. Its retry enters the ordinary “tighten stop” path, which rejects an equal or less-protective stop price. Consequently an unchanged fill can leave initial alignment pending forever; favorable fills can also hit this condition. Retry omits the stored desired TP. Reconciliation compares trade IDs without verifying actual broker protective orders or reconciling externally changed units. [Initial alignment failure](../../backend/src/services/LiveTradingEngine.js#L2117), [strict improvement gate](../../backend/src/services/LiveTradingEngine.js#L3208), [broker synchronization](../../backend/src/services/LiveTradingEngine.js#L259)

An equal-price retry reproduction made zero modification calls and left the pending state intact. This does not mean normal entries have no stop: initial stops are attached to orders, and broker records support protection for the observed trades. The problem is failure recovery and continued confirmation of protection.

Correction direction: distinguish initial protection confirmation from monotonic tightening, verify SL/TP and units against broker truth, retry both orders where required, and expose prolonged uncertainty as an account-wide entry halt and operator alert.

**F5 — P1, observed exposure: live controls are unauthenticated.**

Express mounts the API after CORS/JSON middleware with no authentication. The close-trade route directly calls the broker, and start/stop/config controls are similarly unprotected. The production reverse proxy serves the app at `http://fx.oakroad`; an unauthenticated GET of `/api/account` returned HTTP 200 from the review machine. No mutation or exploit request was sent. [Middleware and routes](../../backend/server.js#L123), [broker close handler](../../backend/src/routes/tradingRoutes.js#L532)

The API listens on all interfaces, although a direct connection to port 3101 timed out from this machine. This review establishes access through the local-network proxy; it does **not** establish Internet exposure. Anyone or any process with equivalent reachable access has no application identity check separating account reads from consequential controls. CORS alone is not authentication or sufficient protection against requests being executed.

Correction direction: authenticate and authorize controls, apply appropriate origin/CSRF protection, and enforce the intended network boundary. Keep operational credentials and broker rights outside frontend code.

**F6 — P1/P2, latent: pause acknowledgement is weaker than it appears.**

`ConfigService.save()` catches write failures and returns false; its caller ignores that result after changing in-memory config. A pause can therefore report success while the persisted file still enables trading, and a restart can resume entries. The write is also not atomic. Separately, an entry already validating can continue with its captured config after pause acknowledgement because submission has no final activation-state check. [Config persistence](../../backend/src/services/configService.js#L97), [ignored save result](../../backend/src/services/configService.js#L175), [submission](../../backend/src/services/LiveTradingEngine.js#L2663)

Correction direction: make durable pause failure visible and fail closed, use atomic persistence, invalidate queued work, and recheck the current activation generation immediately before submission. This also strengthens the flat-account assumption used by deployment and backup workflows.

**F7 — P1, latent: full restore deletes the credentials required to restart the bot.**

Normal archives exclude `.keys` and `.secrets`. The full-restore safety archive excludes them too, then the restore deletes the entire installation before extracting the archive. The start wrapper expects those credentials under the deleted directory. [Archive exclusions](../../scripts/backup.sh#L235), [restore deletion](../../scripts/restore.sh#L139), [credential loading](../../scripts/start-wrapper.sh#L11)

Correction direction: establish separately secured credential recovery or preserve the existing secrets during an appropriate same-host restore; validate the database/schema and restore into a paused state. Exercise recovery in an isolated environment with broker mutations disabled. This is a recovery-procedure defect, not evidence that the current SQLite snapshots are corrupt.

**5. Other material findings**

| Finding | Evidence and consequence | Recommended direction |
| --- | --- | --- |
| **P2: market-data freshness checks use retrieval time** | Prices receive `timestamp: fetchedAt`; candles track last fetch, not last completed bar. Failed candle refresh preserves old history, and strategy evaluation has no age gate. An August synthetic breakout still emitted BUY with a September evaluation clock. Weekend health reported prices/candles “fresh” despite Friday broker timestamps, although non-tradeable status correctly prevented entries. [Price timestamp](../../backend/src/services/OandaDataService.js#L155), [candle freshness](../../backend/src/services/OandaDataService.js#L496), [session clock](../../backend/src/strategies/intradayMomentum.js#L241) | Track broker event time separately from successful polling; enforce current completed M15/H1 bars with market-calendar awareness and bounded grace. |
| **P2: data fetching has no application timeout** | The separate data service calls `fetch` without an abort deadline; its in-flight flags can remain set while a request hangs. This differs from the bounded execution client. [Data request](../../backend/src/services/OandaDataService.js#L63) | Bound requests, release in-flight state on timeout, and alert on missing completed cycles. |
| **P2: cost guard is not final** | Final quote validation does not recompute spread/cost or inspect quote age. Also, strategy `Number(null)` turns a null spread into zero; isolated reproduction emitted an actionable signal. Other engine checks may still reject it. [Final quote](../../backend/src/services/LiveTradingEngine.js#L1794), [numeric helper](../../backend/src/strategies/intradayMomentum.js#L82) | Fail closed on missing quotes and apply all cost/freshness gates at the submission boundary. |
| **P2: health checks do not establish trading safety** | `/health` hardcodes `ok`; the shell accepts a response without checking service flags and does not fail when final account verification fails. Neither live health nor alerts checks overdue positions or the age of pending protection/close work. [Health response](../../backend/src/routes/tradingRoutes.js#L193), [shell gate](../../scripts/health-check.sh#L31), [account verification](../../scripts/health-check.sh#L176) | Verify dependencies and broker state, distinguish weekend/cooldown from degradation, and independently alarm on overdue exits and unresolved lifecycle work. |
| **P2: release freeze can be disabled through config API** | `enforceConfigFreeze` is an unprotected operational key; setting it false permits later protected parameter edits. Hard risk ceilings still apply in relevant paths. [Protected-key definition](../../backend/src/config/tradingConfig.js#L82), [freeze check](../../backend/src/services/configService.js#L141) | Treat release protection as server policy, not a client-editable switch. |
| **P2: fee sign is wrong for nonzero commissions** | Reconciliation adds commission to profit, while OANDA represents charged commission as positive. A real-method reproduction of +10 gross, −1 financing, +2 commission returned +11 instead of +7. All 17 M15 trades had zero commissions/guaranteed fees, so their verified net results are unaffected. [Cost calculation](../../backend/src/services/tradeReconciliationService.js#L101), [OANDA fee semantics](https://developer.oanda.com/rest-live-v20/transaction-df/) | Normalize broker fee signs and reconcile direct-close results with cumulative trade financing. |
| **P2: session and net-return cohorts can mislead** | Analytics uses fixed UTC session bins, unlike pair-specific timezone-based strategy sessions. Its detailed cohort calculation also classifies AUD wins/losses using pip P&L; a price-positive but net-negative trade can disappear from gross AUD losses. An isolated example produced PF 999 instead of 3.33. [Session classifier](../../backend/src/services/analyticsService.js#L37), [cohort accounting](../../backend/src/services/analyticsService.js#L1905) | Reuse persisted entry sessions/overlaps; calculate net AUD and price-pip statistics independently. |
| **P2: dashboard gives false or unsupported impressions** | Live UI showed **0.0% / 0 Trades** on the main dashboard, while Analytics correctly showed 17 trades and 29.4% wins. The portfolio payload lacks the field used by that card. Analytics also displays “ADX filter appears effective” as a default despite neutral winner/loser ADX evidence; this is not a causal test of the filter. [Card](../../frontend/src/components/dashboard/StatCards.jsx#L68), [ADX recommendation](../../backend/src/services/analyticsService.js#L1709) | Fix missing data contracts and remove unsupported strategy recommendations; prominently show sample size and uncertainty. |
| **P2: analytics scopes and periods differ** | API forces current strategy despite “All Strategies” and historical-run choices; S3 analytics are unfiltered live. Period filtering uses entry time, while realized 24-hour dashboard P&L uses exit time. The normal dashboard profile omits detailed entry/rejection cohorts. [Forced strategy](../../backend/src/routes/tradingRoutes.js#L868), [dashboard profile](../../backend/src/services/analyticsService.js#L526), [trade period](../../backend/src/repositories/tradeRepository.js#L238) | Define explicit release/all-live scopes and entry-cohort versus realized-period reports; use the same filters in UI and exports. |
| **P2: report delivery is not reliable evidence retention** | Current startup logs say S3 credentials are incomplete and uploads disabled. In code, failed upload results still advance daily/weekly completion markers. [Scheduler](../../backend/src/services/s3ReportScheduler.js#L77) | Expose disabled reporting, distinguish attempt/success, retry failures and retain immutable report intervals. |
| **P2: backend has known dependency advisories** | Current npm production-lockfile audit flags three moderate affected packages—`qs`, `body-parser`, `express`—through two qs advisories. Production has Express 4.22.2 and qs 6.15.3. No high/critical advisory was reported; frontend production-dependency audit reported zero. [Array-limit advisory](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [isBuffer denial-of-service advisory](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | Apply a reviewed lockfile update and regression checks; no exploitability claim or exploit test was made. |
| **P3: documentation teaches future reviewers the retired app** | CLAUDE.md presents paper/shadow promotion, seven strategies and SuperTrend as current. Current release docs prohibit that architecture. Deployment notes also lag observed production. [Stale current-state instructions](../../CLAUDE.md#L108) | Create one authoritative current-state section and clearly label historical design/incident notes. This directly reduces repeated model-upgrade regressions. |

Breakeven activation also uses midpoint rather than the executable closing side, moving the stop at slightly less than 1R of realizable price profit. Pullback logic compares historical candles to the current EMA, rather than the EMA at each historical candle. These are specification/strategy interpretation issues worth documenting and testing; neither was established as the cause of losses in this sample. [Breakeven inputs](../../backend/src/services/LiveTradingEngine.js#L3172), [pullback rule](../../backend/src/strategies/intradayMomentum.js#L410)

**6. Where the live evidence points next**

The stored display labels say 16 pullbacks and one breakout. Recovering the actual booleans from durable intent payloads reveals a different split: seven of those “pullbacks” also satisfied breakout conditions.

| Actual trigger combination | Trades | Net AUD | Mean net R |
| --- | ---: | ---: | ---: |
| Pullback only | 9 | +0.7597 | +0.434 |
| Pullback and breakout together | 7 | −0.5463 | −0.400 |
| Breakout only | 1 | −0.1972 | −1.010 |

| Pair / side | Trades | Net AUD | Interpretation |
| --- | ---: | ---: | --- |
| USD/JPY | 11 | +0.5641 | Positive small cohort |
| EUR/USD | 6 | −0.5479 | Negative small cohort |
| AUD/USD | 0 | 0 | No filled evidence; quote rejection defect is relevant |
| GBP/USD | 0 | 0 | No filled evidence; spread and quote rejections are relevant |
| BUY | 10 | −0.4562 | Includes all six EUR/USD trades |
| SELL | 7 | +0.4724 | All seven are USD/JPY; side and pair are confounded |

The useful research question is whether pure pullback continuation behaves differently from a breakout/pullback overlap, after fixing execution and exits. It is **not** yet justified to remove EUR/USD, remove buys, or trade only the retrospectively best subgroup. The groups are tiny, correlated and selected after seeing outcomes. The BUY/SELL result cannot separate a side effect from a currency-pair effect.

All 17 observed exits were broker stop/target exits: seven initial stop losses, five take profits, and five breakeven-stop exits, one of which was net negative. There are no time-stop or session-close exits, consistent with F1. Without executable-price maximum favorable/adverse excursion and subsequent price paths, the sample cannot establish whether breakeven saves losses or cuts off winners.

I recommend this order of work for a subsequent authorized implementation pass:

1. **Restore the intended experiment.** Connect timed exits; correct final quote selection and protection alignment; make reconciliation, pause and broker uncertainty fail closed. Prove these through the real orchestration path, including network-failure/restart cases. Address unauthenticated controls and unsafe restore behavior alongside these operational defects.
2. **Make the evidence trustworthy.** Persist final bid/ask liquidity, broker timestamps, candle timestamps, initial AUD risk, actual fill/close costs, trigger overlap, actual session set, MFE/MAE, exit obligation and completion, and precise rejection reasons. Some already exist in nested intent payloads; expose them consistently instead of duplicating them without need.
3. **Start a clean release cohort at the existing small limits.** Keep the prior results immutable and distinguish the exit/quote corrections from the earlier hypothesis. Follow the repository’s versioned live-only process. Do not increase trade frequency by weakening filters until the corrected funnel is understood.
4. **Review after the documented operational checkpoint, then over a larger varied sample.** Require no missing protections, duplicate entries, missed timed exits, unclassified rejections or broker/account mismatches. Evaluate net AUD/R, realized costs, drawdowns and the uncertainty around expectancy. Thirty trades alone is insufficient to justify scaling.
5. **Change one coherent trading hypothesis only when the clean evidence supports it.** The trigger-overlap split is a candidate for investigation. A proposed change should state its economic rationale and success/failure criteria before collecting the next live cohort, and include all costs rather than relying on nominal reward/risk or win rate alone.

I would hold off on increasing capital and prioritize the P1 corrections before collecting more supposedly representative intraday results. Trading remains in the state found; this review did not pause or restart it.

**7. Operations and verification**

The redesigned backup workflow is materially better than the incident history describes: it locks overlapping work, bounds snapshots, publishes atomically, checks integrity and refuses to stop monitoring while a broker position exists. Production logs show the September 4 database snapshot correctly deferred because one trade was open; source archiving still completed. Three verified database snapshots were retained, dated September 3, 5 and 6.

I independently opened the September 6 snapshot read-only/immutable and ran `PRAGMA quick_check`: **ok**. That validates this database copy, not the full restore procedure or credential recovery. The observed backups reside on the same host/root filesystem; an independently recoverable off-host copy was not verified. Current app S3 reporting is disabled according to startup logs.

The live database is approximately 2.97 GB, but about 2.47 GB—83%—consists of free pages left by deletions. Backups continue copying that allocated file. This is a maintenance opportunity to reduce snapshot time and SD-card writes during an approved flat/paused maintenance window; it is not an immediate disk-space emergency. Logs occupy approximately 932 MB. No database compaction or cleanup was performed.

Recent September logs included 51 throttled price-fetch error messages and nine queue-processing errors associated with the quote rejections. Services were recovered and healthy at inspection. “Healthy now” should not substitute for a recorded account of interrupted decisions or failed position management.

| Verification | Result / limit |
| --- | --- |
| Local and production Git identity/status | Same commit `bee8527`, clean before/after |
| Production account | Direct OANDA GETs; flat, zero pending orders |
| Current strategy accounting | All 17 close prices and net P&Ls matched OANDA |
| Production UI | Dashboard and Analytics inspected; misleading main win-rate card reproduced visibly |
| Backend tests | Node 22.23.1, 25 suites / 313 tests passed; 3 suites / 47 tests failed to initialize because local `better-sqlite3` native binding is absent |
| Failing test suites | TradeRepository, PortfolioRepository and StrategyRunRepository; missing native-binding failures, not established product regressions |
| Backup regression script | All tests passed using the script’s isolated stubs |
| Behavioral fault reproductions | Missing timed-exit invocation, flat reconciliation, cross-pair quarantine count, inert equal-stop retry, commission sign, stale-candle acceptance, null spread and analytics cohort/session errors |
| Dependency checks | Production-dependency lockfile audits; backend three moderate affected packages, frontend zero |
| Latest immutable DB backup | SQLite quick_check passed |
| Builds/deployments/restores | Not run, consistent with first-pass scope and repository instructions |
| Live mutation/failure injection | None; no test orders, stop modifications, pause, restarts, alert emails or outage tests on production |
| Remaining limits | No full historical account transaction reconciliation, external Internet exposure audit, off-host restore drill, email-delivery test, or live market-open execution observation |

The existing execution and risk code has valuable foundations: durable order intents, broker client IDs, FOK/OPEN_ONLY orders, attached stops/targets, explicit AUD conversion, retained run ownership, bounded broker execution requests, broker-close reconciliation and small account risk. The recurring weakness is integration: a policy can exist, be unit-tested and appear in documentation without being invoked or verified by the live lifecycle. That is the main lesson this review would carry into the next implementation pass.
