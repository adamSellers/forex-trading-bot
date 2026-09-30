# Current status and decision points — 26 September 2026

## September 30 authorized reset release

The user subsequently authorized implementation, GitHub publication and deployment of the [v4.2 H1 loss-reset requirement](2026-09-30-loss-reset-release.md). This changes normal same-pair/same-side re-entry after an initial stop only: completed H1 nonqualification followed by later renewed qualification, then a valid M15 trigger. Breakeven outcomes and existing TP/BE/fade policies retain their treatment. Source, numerical risk limits and historical records remain governed by the existing one-way workflow. See the release record for live completion state.

## September 30 checkpoint — v4.1 deployment verified

Read-only inspection verified clean user-deployed `672283897ebd0c26e4924757826c4d2dcd87f329`, **m15-intraday-v4.1 / strategy 1.2.1**. This supersedes the pending-deployment statements in the historical September 28 checkpoint below. The [repeated USD/JPY review](2026-09-30-repeated-usdjpy-review.md) directly verifies four consecutive sells with OANDA: one old-release initial stop, two v4.1 initial stops and one v4.1 breakeven scratch. The three current-release trades total −A$0.3521. At the September 30 06:46 AEST API snapshot the bot was enabled and flat, with entries in cooldown until September 30 22:13:58 AEST; subsequent broker balance/NAV was A$95.6166.

The re-entry policy deliberately leaves ordinary stop-loss repeats eligible; only TP/breakeven exits receive the added freshness check. Distinct completed candles and single-submission intents rule out a demonstrated duplicate-order explanation for these trades. Applying the existing freshness predicate after stop-losses would still pass all three new entries. No loss-specific invalidation rule has been selected or implemented. This review changed local documentation/evidence only; production and runtime behavior were unchanged.

## September 28 checkpoint — deployed v4, local v4.1

Read-only inspection verified clean user-deployed `aed750f27cd0ed24219b2965c443ba45ac05499a`, **m15-intraday-v4 / strategy 1.2.0 / intraday-risk-v4**. Dashboard/API and OANDA were online, prices/candles fresh, entries enabled, account flat and repeated readiness checks passing. Active run: `live_3c068476-9fad-4079-bb82-c24889350374`; config: `49808daa3caffd0405c4`; no v4 fills at the 14:35–14:37 AEST snapshot. S3 uploads remained unconfigured. Earlier pending-v4-deployment statements below describe the September 26 checkpoint and are superseded by this observation.

The user then explicitly requested removal of the global position-count cap so valid setups on different pairs may enter concurrently. The [September 28 release record](2026-09-28-pair-capacity-release.md) specifies local **m15-intraday-v4.1 / strategy 1.2.1 / intraday-risk-v4.1**: one position per pair, no account-wide count cap, and unchanged per-trade sizing, portfolio/margin/loss limits, broker safety and strategy rules. The retired setting is removed from active configuration/readiness; API/UI report the explicit per-pair policy. Saved settings/enabled intent survive except that field; historical snapshots, active cooldown expiry and prior ownership remain intact.

**V4.1 is implemented and locally validated; it is not deployed.** Latest passing results cover 850 tests across 41 backend suites, assembled from the full run and targeted reruns, plus changed JSX syntax checks. The release record links the retained validation evidence. The 0.5%-of-NAV aggregate stop-risk limit remains unchanged and can still reject additional full-risk pairs. Publication, builds and rollout remain user-managed through the normal GitHub-to-bot deployment. No production mutation or test orders occurred during this work.

| Decision / finding | Current state | Remaining work |
| --- | --- | --- |
| V4 integrated rules and precision/RSI changes | Deployment verified September 28; original local validation was 834 tests across 41 backend suites | Review natural live trades and fade episodes; no established positive expectancy |
| Global position cap | Explicit user decision removes it in local v4.1; same-pair exclusion and all existing portfolio/risk limits remain | Local validation complete; user-managed publication/build/deployment and live observation remain |
| System tab capacity display | Deployed “Max: 2” is an inaccurate fallback; actual v4 cap is one | V4.1 reports “one per pair” with matching API policy |
| Reporting/recovery/delivery | S3 unconfigured; independent restore and email-delivery checks still outstanding | Separate operational follow-ups; no new destination or notification selected |

## September 26 record (historical checkpoint)

This handoff separates the [September 26 performance review](2026-09-26-follow-up-trading-review.md), last verified production state and the subsequently authorized [integrated v4 implementation](2026-09-26-integrated-release-specification.md). The user first requested documentation while reading the review, then discussed the complete package and explicitly authorized its specification and implementation.

**Local source now implements m15-intraday-v4 / strategy 1.2.0 / intraday-risk-v4. Local validation passed: 834 tests across 41 backend suites; the changed analytics JSX also passed syntax validation; it has not been published or deployed.** The specification records exact behavior and final acceptance results. Production remains last verified at v3.3 below.

## Last verified production state

| Item | Verified observation |
| --- | --- |
| Source | Clean `5889b66ca0cf88bb17298c8d9a9b2ed0abfccf75`, observed by read-only SSH on September 26; exact deployment time was not established |
| Runtime | One live OANDA AUD account; `intraday_momentum`, release `m15-intraday-v3.3`, strategy `1.1.3` |
| Cohort | Run `live_a8458577-5451-4c6b-ae9b-adfe95d2fcf3`, config `51bcdfe44054c4f69668`; unchanged by the measurement correction |
| Entry / exit settings | Existing M15/H1 rules; stop=max(1.25 M15 ATR, six pips); target 1.5R; breakeven at 1R; six-hour time stop and New York 16:45 closure window; no fresh-post-exit re-entry gate |
| Risk settings | 0.25% of capped/buffered sizing capital, A$100 ceiling, one position, three-loss 24-hour cooldown; unchanged |
| Measurement | Version 2 excursion correction deployed; all ten newly reviewed trades have verified broker-lifetime samples and no legacy aggregate |
| Operating snapshot | Enabled and flat, no broker trades/pending orders or unresolved exposure; balance/NAV A$95.9687; expected loss cooldown until 27 September 03:37:28 AEST |

The operating snapshot is an observation around **26 September 06:47 AEST**, not a continuing health assertion. Read current dashboard/API state for a later operating decision. The local implementation has not changed production enabled state or advanced/cleared a cooldown.

## Performance evidence now available

The latest interval is **21 September 20:35–26 September 06:45 AEST**, end excluded: 4 days 10 hours 10 minutes continuing exactly from the prior review, not a second seven-day window.

| Cohort | Trades | Net AUD | Meaning |
| --- | ---: | ---: | --- |
| New interval | 10 | **−0.5369** | Broker-verified; 2 positive / 7 negative / 1 flat; −0.5563%; profit factor 0.497 |
| Same v3.3 run, previous 15 plus new 10 | 25 | **−1.2693** | Same numerical strategy/run/config; profit factor 0.513 |
| Since September 6 review | 35 | **−0.7871** | Includes ten earlier trades across v3/v3.1/v3.2; not a single controlled cohort |

All ten new fills, closes, units and net P&L match the broker. All ten entries had attached stop and target protection; no duplicate fills or overlapping positions were found. The correction removed six post-close observations across six trades, leaving 4,701 verified observations. Verified samples still omit between-poll movement and cannot establish exact tick extrema.

The entry-quality concern is broader than quick re-entry. All five new pullback-only trades lost A$0.7212, while five both-trigger trades netted +A$0.1843. These groups also occupy different parts of the week. Six of seven losing trades showed less than +0.5R sampled favourable movement. These observations identify research priorities; they do not select new thresholds or prove a profitable exclusion rule.

## Decision register

| ID | Topic | Current status / recommendation | Decision or work still outstanding |
| --- | --- | --- | --- |
| D1 | Excursion correction | **Implemented and verified deployed.** First-new-trade verification is complete for all ten reviewed trades. Historical aggregates remain unverified. | Continue to label sampling coverage and legacy data honestly; no additional deployment of this correction is pending. |
| D2 | 1.5R versus 2R target | **Retain 1.5R for normal and fade entries in local v4.** New conditional 2R results are effectively unchanged/slightly worse. | No larger target, trailing exit or wider stop is selected. Preserve breakeven, original deadlines, capacity and costs. |
| D3 | Fresh post-exit pullback | **Implemented locally across both trigger branches**, as part of the integrated policy below. Last verified production still has no freshness gate. | Local acceptance passed; user rollout and natural live episode review remain. The prior screen removes losing 3393 but also has winning counterexample 3085. |
| D4 | Pullback entry quality | **Structural candidate selected and implemented locally.** Use each prior bar's EMA20/EMA50 and clear the structure from the latest touch, retaining the prior-two-bar minimum. | The candidate removes five of 35 actual fills, net +A$0.0315 including two winners. No validated profit improvement. Latest available attempted setups change 59→55; 18 GBP/USD setups lack retained candles. |
| D5 | Serialized-price risk/deviation bound | **Corrected locally.** Size, validate and persist exact serialized stop/bound prices; round adverse bounds inward without increasing limits. | Local engine/client acceptance passed; user rollout remains. Actual reviewed fills/initial risks stayed within budget; the defect does not explain the trading losses. |
| D6 | Capital and numerical risk limits | **Unchanged. No increase selected.** | Any future funding/limit change remains a separate explicit user decision under the standing project constraints. |
| D7 | Reporting, recovery and scalar RSI | **Scalar RSI population implemented locally**, retaining unknown values as null. S3, independent recovery drill and email-delivery verification remain open. | Decide whether the S3 destination is still wanted; verify recovery/delivery separately when authorized. No new dashboard, destination or notification was added by this release. |
| D8 | Post-TP fade | **User-requested experiment implemented locally.** An otherwise-valid same-direction signal after normal TP without freshness may execute once in the opposite direction. | Four conditional paths yield two targets and two stops; no retained BUY-to-SELL example. Actual-direction protection, episode durability and management passed integrated acceptance; assess future live evidence without claiming an established reversal edge. |

### D3/D8: integrated continuation and fade contract

Use the latest broker-confirmed closed live trade in the pair, ordered by broker close time across release boundaries. For a normal TP/BE anchor followed by an otherwise-valid same-direction signal, require at least one of the four prior completed M15 candles to **start at or after the broker exit** and touch the EMA20 calculated at the new signal: low ≤ EMA20 for a buy, high ≥ EMA20 for a sell. This signal-EMA test is intentionally distinct from the new own-bar EMA semantics of ordinary pullbacks. It applies to breakout and pullback signals alike; an exit-straddling bar is not fresh evidence.

The signal must complete strictly after the protected exit; a previously completed candle cannot be reused as a fade. Resolve the exit from matched broker timestamp evidence, not a local fallback in `brokerClosedAt`. Missing protected-exit time proof waits for evidence, while opposite/unprotected normal entries retain their eligibility.

A fresh signal may continue normally. Without freshness, a normal TP episode may produce one opposite-direction fade; a BE episode waits. A local pre-submission pricing rejection does not consume the episode, and eligible retries retain their first decision-price reference. One filled fade consumes it. The fade's close carries its parent normal TP anchor and consumed state, so it cannot arm another fade or erase the original freshness requirement. A later filled/closed normal trade becomes the new anchor. First entries, independent opposite normal signals and repeats after other normal exit reasons retain normal qualification.

The actual order side receives the existing price, cost, shorting, exposure and risk checks. Stops and targets are constructed for that executed side. Reconciliation revalidates the parent/consumed decision before entry. Signal-reversal events neither close an open fade nor close another position to make room for one; normal protective, breakeven and time/session management remains active. See the [integrated specification](2026-09-26-integrated-release-specification.md) for persistence, invalid-history handling, migration and full acceptance requirements.

The [pullback investigation](evidence/2026-09-26/integrated-release/pullback-README.md) and [fade path check](evidence/2026-09-26/integrated-release/fade-findings.md) retain all measured counterexamples. The structural candidate was frozen before this comparison, but reviewed outcomes were already known. Its removed trade P&L and conditional fade paths are not alternative portfolio returns. Multiple simultaneous changes also limit causal attribution of the next live cohort.

### Earlier candidate comparison and its limits

| Conditional observed-fill comparison | Retained entries | Price-distance R |
| --- | ---: | ---: |
| Actual baseline | 10 | −3.23645R |
| 2R only | 9 | −3.27266R |
| Fresh post-exit condition only, target 1.5R | 9 | −2.22695R |
| Both changes | 9 | −3.27266R |

These calculations keep observed fills fixed, update retained predecessor anchors and omit definitely conflicting entries. They do not replay the alternative runtime, add replacement trades or recalculate cooldowns, sizing, conversion and slippage. Every comparison remains negative. An omitted historical loss is not an estimate of future profit. Raising the target helped one winner but turned the other into breakeven before its later 2R move.

### D5: observed versus possible impact

Four of ten serialized orders permitted worst-fill cash risk approximately A$0.00014–A$0.00113 above the saved budget; the largest difference was 0.59% of that budget. The retained 3435 fixture changes the permitted adverse deviation from 1.50 to 1.55 pips when the bound is rounded. **No actual excess-risk fill was observed.** This mismatch does not explain the negative trading expectancy. The [isolated serializer reproduction](evidence/2026-09-26/price-bound-reproduction.cjs) preserves the former defect; it asserts old behavior and is not the corrected regression. Current engine/client acceptance belongs in the [integrated specification](2026-09-26-integrated-release-specification.md).

## Verification and delivery boundary

- The September 21 measurement implementation passed 744 backend tests in 40 suites at that time. The September 26 review verified its deployed behavior; it did not rerun the whole backend suite.
- The September 26 analysis reconciled all ten broker trades, reproduced the retained performance and candidate calculations, and exercised the real broker serializer with HTTP/logging stubbed on Node 22.23.1. See the [evidence README](evidence/2026-09-26/README.md).
- The earlier performance review and documentation pass changed no runtime behavior. The subsequent explicit implementation authorization produced local v4 source and tests; 834 tests across 41 backend suites passed; results are recorded in the specification.
- No manual test orders, production source/process changes, Git commits/publication, builds or deployment were performed in this implementation pass. Publication/build/deployment remain user-managed through the one-way GitHub workflow and single `./scripts/deploy.sh` command. There are no new manual deployment steps.

## Where to continue

Use this register for current state and open choices, the [roadmap](../../project_roadmap.md) for work sequencing, [remediation register](2026-09-06-remediation.md) for finding/change/verification history, [project history](../../PROJECT_HISTORY.md) for dated milestones, and [user guide](../../USER_GUIDE.md) for operating semantics. Dated performance reports and evidence remain historical observations; they are not rewritten as forecasts or deployment claims.
