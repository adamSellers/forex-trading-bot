# Profitability implementation plan

Prepared 6 October 2026 following the project review. The user subsequently requested implementation and deployment. Work starts with demonstrated measurement defects, establishes a reproducible v5 baseline, and then evaluates entry, prediction and exit candidates. The [first implementation release](2026-10-06-analytics-measurement-release.md) tracks A1–A3 and delivery separately. Candidate evaluation can finish without earning a live release; V1/L1 retain the specified evidence and behaviour decision.

## Baseline and scope

Read-only inspection on 6 October at approximately 09:58 AEDT verified deployed revision `73cf4b59b1bc0c3082e477121820f3aa31be9227`, strategy `intraday_momentum` 1.3.0, release `m15-intraday-v5`, execution policy `intraday-risk-v5`, and pricing model `broker-liquidity-v3.1`. The bot was enabled and flat, with A$95.2621 balance. Its v5 cohort contained one USD/JPY BUY initial-stop loss, net −A$0.1787, and no SELL fills. These are dated observations, not continuing runtime assertions. A reduced [planning baseline](evidence/2026-10-06/planning-baseline.json) preserves the relevant observations without credentials or account identifiers.

The prior unchanged v3.3 cohort contained 25 trades, net −A$1.2693, profit factor approximately 0.513. Recent studies show weak entry follow-through and mixed exit sensitivities; they do not establish a profitable replacement. Read the [September 26 performance review](2026-09-26-follow-up-trading-review.md), [October SELL study](2026-10-01-sell-entry-and-exit-study.md), and [v5 release contract](2026-10-01-sell-retest-release.md) alongside this plan.

Throughout this work:

- Preserve one live strategy, broker ownership, durable intents, reconciliation, protective orders and historical trade/run records.
- Preserve 0.25% entry risk on existing capped/buffered sizing capital, the A$100 ceiling, one position per pair, and existing portfolio, margin, loss and quote limits. Research does not authorize relaxing them.
- Keep event time, validated quote receipt, request duration, broker execution time and local observation time distinct. Research clock control must not change their live meanings.
- Keep research offline and separate from production databases and credentials. Do not introduce a simulated product runtime, strategy selector, promotion interface, operational alerts, authentication or new live entry gates.
- Develop and test locally. The subsequent implementation/deployment request authorizes builds, local commits, GitHub publication and the existing deployment command. Preserve local commits → GitHub → deployment; no manual test orders.

## Work sequence

| Order | Package | Deliverable | Completion criterion |
| --- | --- | --- | --- |
| 1 | A1–A3 measurements | Correct persisted cohorts, observed expectancy and uncertainty | Repository-to-analytics checks reconcile known observations |
| 2 | R1 data and protocol | Manifests, coverage report, trial ledger and evaluation boundaries | Inputs and assumptions are explicit |
| 3 | R2 replay and R3 baseline | Deterministic offline evaluator and frozen v5 report | Orchestration/accounting agree on service-shaped fixtures; historical uncertainty is bounded |
| 4 | S1 entry research | Structural BUY and entry-location comparisons | Complete portfolio results for separate candidates |
| 5 | S2 filter contribution | Prespecified indicator ablations | Incremental benefits and costs measured against v5 |
| 6 | M1 prediction and M2 selection | Net-R model and ADX ranking comparison | Out-of-time calibration and decision utility assessed |
| 7 | X1 exits and X2 fades | Separate exit-policy and fade evaluations | Include winners, scratches, opportunity costs and state feedback |
| 8 | V1 decision and L1 selected release | Evidence decision; release specification if warranted | User reviews selected behaviour before live implementation/delivery |

A1–A3 form the first implementation slice. R1 and the R2 architecture spike can proceed together afterward. Candidate studies share the frozen evaluator but retain separate identities and results. Combined live changes must not obscure component attribution.

## A1 Correct persisted signal cohort attribution

**Observed defect:** `SignalRepository` writes `entry_type` but omits `entryType` when mapping rows. Analytics falls back to intent, while decisions/trades use their actual entry type. The current capture splits two `ENTER_LONG` signals from two `M15_PULLBACK_RESUMPTION` decisions and one fill. Totals reconcile; cohort conversion rates do not.

**Implementation:** map saved entry type consistently in full and compact reads. Trace signal deduplication, cohort construction, analytics, API and export consumers. Keep entry type, intent, trigger membership, executed side and normal/fade/retest classification distinct. Preserve legacy unknown values and raw records; no historical rewrite or migration is expected.

**Files:** `backend/src/repositories/signalRepository.js`, its tests, `backend/src/services/analyticsService.js`, analytics/route integration tests; compact-query projections only if the field is absent there.

**Acceptance:** save signals through real isolated SQLite repositories, then read them into analytics alongside matching decisions and trades. Verify current/run/all-live scopes and full/dashboard profiles. Two distinct actionable setup/candle events sharing the pullback cohort must show one fill and one `ALREADY_IN_POSITION` rejection without duplicated conversion denominators. Filled, submitted and uncertain setups retain existing suppression; this correction does not permit another attempt after a fill. Include legacy unknown entry type, distinct entry types, run/config boundaries and normal/fade attribution.

## A2 Make inferential availability explicit

**Observed limitation:** a singleton bootstrap resamples the same observation every time. Its zero-width expectancy/net-R interval is not evidence of certainty about future returns. Constant samples have the same inferential limitation.

**Contract:** retain point estimates, units, observation counts and `samples` meaning bootstrap resamples. Return nullable expectancy/net-R bounds and additive availability status/reason for empty, singleton and degenerate empirical samples. Retain a qualified calculation for diverse samples. Preserve the separate Wilson win-rate interval where defined; do not conflate it with bootstrap expectancy or turn the existing 100-trade flag into a profitability threshold.

Trace `analyticsStatistics.js` → `analyticsService.js` → route/dashboard → S3 JSON reports. Show the observed mean and why inference is unavailable; do not format null bounds as money. Preserve field names and document nullable-bound compatibility. Historical saved reports remain immutable.

**Acceptance:** empty, singleton, constant and diverse samples. The current singleton retains −A$0.1787 and approximately −1.0023R while expectancy inference is unavailable. Check repository payload round trips, missing original risk, entry/realized interval boundaries, route JSON, dashboard rendering and report serialization. Missing risk excludes a trade only from R with coverage disclosed; it remains in net AUD totals.

## A3 Separate observed performance from prospective expectancy

**Observed defect:** the retrospective `calculateExpectedEdge` call uses a binary model that treats every nonwinner as a loss. For +30, −10 and 0 pips, the direct mean is +6.67 pips but the helper returns +3.33. AUD classification can also differ from pip-sign classification after financing or conversion.

**Contract:** direct means remain authoritative: sum of realized net AUD / all closed trades; sum of executable-price pips / all closed trades; and each trade's net AUD / saved original AUD risk for R. Include flat, timed, session and reversal outcomes. Spread embedded in executable prices must not be deducted again.

Use explicitly labelled, separate AUD and pip outcome counts/conditional averages where a decomposition is needed. The AUD decomposition must equal `P(win) × mean win AUD + P(loss) × mean loss AUD + P(flat) × 0`. Stop using the binary prospective helper to label retrospective cohorts. Introduce explicitly observed output, mark nested retrospective `expectedEdge` deprecated, and document its compatibility/removal treatment after tracing API/S3 consumers. Do not silently repurpose the helper or field as a trained forecast. M1 predictions use separate fields and model identity.

**Files:** `analyticsService.js`, `expectedEdge.js` only if a demonstrated caller contract requires adjustment, related tests, API/report consumers and documentation.

**Acceptance:** mixed winners/losers/flats, all-flat samples, zero-price-pip financing loss, AUD/pip sign disagreement, missing original risk and explicit costs. Means match independent ledger arithmetic before rounding. Verify persisted analytics and reports in full/dashboard profiles.

## R1 Establish data and experiment contracts

Create a small research area under `backend/research/` with input manifests, candidate specifications and a trial ledger. Store reduced reports under dated `docs/reviews/evidence/` directories; identify large raw captures by hash and reproducible location rather than committing them. Record source revision, strategy/config identity, evaluator/adapter version, provenance, instruments, timeframes, units, price components, coverage, warmup and exclusions.

Audit the available 2020–August 2026 seven-pair M15 midpoint/bid/ask archive, September/October evidence, AUD conversion coverage, spread observations and management/transaction timestamps. Check ordering, duplicates, OHLC consistency and missing intervals. Derive H1 causally only where complete inputs and broker alignment are established, checking retained H1 observations. Missing evidence remains unavailable, not a fabricated healthy quote or zero cost. Normal quiet intervals and repeated successfully received quotes retain their existing meanings.

The archive and already-reviewed September/October outcomes are development/retrospective robustness evidence; old holdout labels do not make them untouched again. Historical rolling walk-forward remains useful but exploratory. Register candidate definitions, features, objective, parameter/trial budget, cost cases, uncertainty method and evaluation boundaries before inspecting a genuinely future interval. Future data after that freeze supplies untouched evidence; this plan does not create a scheduled monitor.

Warm indicators from an unscored prefix. Purge training labels whose outcome windows overlap validation/test periods; fit transforms/calibration on training data only. Preserve or explicitly account for open trades and pattern/reset/cooldown state at boundaries. Keep rejected and abandoned trials in the ledger.

**Acceptance:** a second local run resolves the same inputs and reproduces coverage from the manifest; unsupported precision/cost assumptions and missing periods are visible.

## R2 Build the offline chronological replay

Start with an architecture spike using existing Jest fake clocks, mocked brokers and isolated SQLite integration patterns. `RuntimeCoordinator` accepts many dependencies, but the engine imports broker/email singletons and several paths independently use `Date.now()`. Loss-reset and SELL-evidence resolvers also compare supplied time with wall-clock time. Passing an old timestamp into the strategy alone is insufficient.

Run an isolated process with controlled time, repositories, market/account observations, broker-shaped responses and no outbound network. Reuse the actual coordinator, signal generator, entry queue, strategy, execution/risk policies, management, reconciliation and evidence resolvers. Do not start the server, read production credentials or write into production. Add narrow dependency seams only if established test boundaries cannot support replay; live defaults/behaviour remain equivalent. Candidate overrides stay outside the deployed strategy catalog.

Proposed research modules: runner, event clock, market adapter, stateful broker fixture, repository setup, ledgers and reporting under `backend/research/`; choose the smallest structure proven by the spike. Control generated research identities or canonicalize them consistently while preserving run/setup/attempt/intent/trade references; random UUIDs must not prevent reproducible ledger comparison. Actual historical identifiers remain intact. A local command should rerun a manifest without manual steps.

Schedule candle availability, quote receipts, scans, orders/fills/protection, management polls, exits and restart checkpoints chronologically. Control and verify both wall-clock time (`Date.now()`/calendar time) and monotonic request duration (`node:perf_hooks`), including receipt/request-budget boundaries. Distinguish broker-held stop/target triggers from five-second data polling and ten-second app management. Preserve broker precision, adverse bounds, original retry anchors, whole-unit sizing, margin and contemporaneous AUD conversion. Account for measured slippage/financing/explicit costs once.

Each candidate evolves its own ledger, NAV, margin and eligibility. Carry same-pair exclusion, concurrent positions, portfolio/currency exposure, normal/fade ownership, protected-exit anchors, H1 resets, consumed retests, submission uncertainty and cooldowns forward. Skipped trades expose later opportunities; observed fills cannot be the only possible entry list. Reproduce configured correlation inputs, including their absence, rather than assuming an unpopulated map enforces distinct-pair correlation limits.

Declare two evidence levels: M15/H1 causal screening, and finer execution evaluation for finalists. OHLC does not identify paths between extrema, even on short bars. Evaluate plausible orderings/cost cases and flag unresolved boundary events. Illustrative high-first/low-first paths are sensitivities, not guaranteed bounds: additional recrossings and unknown management polls can change outcomes. Claim a bound only where the admitted possibilities are exhaustively covered; otherwise retain an explicit possible-outcome set or unavailable result. Interpolated five/ten-second prices are not observed quotes or exact broker replay. Obtain read-only finer evidence only where it can resolve a specific finalist uncertainty.

**Acceptance:** completed history → coordinator → engine → broker response → persisted trade → reconciliation → later decisions. Include valid BUY/SELL fills, JPY/non-JPY precision, local cost/price rejection and valid reconsideration, absolute SELL stops, adverse fills, uncertainty, stop-update timing, timed/session exits, restart, competing pairs and changed eligibility after losses/protected exits. Verify simulated response delays, quote expiry and retry deadlines across wall and monotonic clocks. Valid operations remain possible. Deterministic reruns preserve identities/references and produce identical comparable ledgers; restart/cache-rollover cases match uninterrupted runs. Any live dependency seam passes relevant regression suites.

## R3 Freeze and report the v5 baseline

Pin v5 strategy/config identity and input/evaluator manifests. Reconstruct older cohorts using their own recorded contracts and local source revisions, not v5 rules. Verify retained signals, decisions, protection arithmetic and lifecycle observations at available precision. Report model/broker discrepancies instead of claiming exact fill agreement from candles.

Produce opportunity/decision and trade ledgers, account/equity traces, rejections, costs, initial-risk coverage, normal/fade/retest attribution, net AUD/net R, drawdown, exposure concentration and uncertainty/coverage reports. Retain ADX sorting and all existing gates/risk limits. Low cadence is an observed result, not a reason to force trades.

**Acceptance:** independent accounting reconciles cash, exposure, results and risk denominators; service-shaped parity passes; assumptions/uncertainty accompany every performance claim. Freeze this baseline before candidate outcome comparisons.

## S1 Evaluate structural BUY and entry-location candidates

Register two separate hypotheses with existing cash-risk limits and exits:

1. **Structural BUY pullback stop:** retain current normal BUY entry rules. For pullbacks, including both-trigger entries, test a stop below the lowest historical bid low from the latest qualifying touch through confirmation, with a price-tick buffer and existing minimum-distance floor. Breakout-only BUYs remain baseline entries. Specify cancellation, crossed-anchor and missing-bid cases before scoring.
2. **BUY break/retest confirmation:** separately test v5's directional counterpart: completed bullish break above the prior range; distinct later retest closing above the frozen level; distinct later bullish confirmation above the retest high without retouch. Cancel on a close at/below the level; another retouch updates the retest and cannot confirm on that candle. Stop below the episode bid low. Define evidence persistence and one-fill consumption before scoring. Keep current normal SELL rules fixed.

Measure entry/structure distance, stop/ATR, target/ATR, opposing-level distance and remaining exit time using pre-entry evidence. Initially report features; do not invent live cutoffs from a few losses. Compare every eligible episode and evolving portfolio path, including damaged winners and altered opportunities/cooldowns.

**Shared contract dependencies before full-path research scoring:** structural stops are currently SELL-only in `executionPolicy.js` and engine rounding/target paths. Direction-generalize the minimum shared structural resolution, worst-fill sizing, protective-price rounding, fill-based target/breakeven, durable intent recovery and final revalidation needed to evaluate BUY candidates through the actual engine. This local work preserves v5 entry eligibility: only isolated research candidates emit the new BUY structural plan. Live BUY rule/version activation remains conditional on L1. Keep the submitted absolute stop fixed after fill. Use bid structure for BUY liquidation, not midpoint minus guessed spread. A crossed invalidation level cannot be rescued by the minimum-distance floor. Preserve v5 SELL/distance-plan behaviour. Do not silently reuse SELL pattern fields for BUY evidence.

**Files:** research candidates and the minimum shared direction-generalization in `executionPolicy.js`, `LiveTradingEngine.js`, persistence/recovery consumers and integration suites before full-path scoring. Research uses an explicitly named BUY structure/evidence policy. Any change to deployed `intradayMomentum.js` BUY eligibility remains in the separately selected L1 release.

**Acceptance:** separate complete candidate reports; mirrored BUY/SELL precision, fill-risk, final revalidation and restart/recovery cases if a shared contract changes. Missing/crossed structure prevents the candidate while healthy valid setups remain executable. Evaluation itself does not change live BUYs.

## S2 Measure indicator contribution

Register limited, one-component-at-a-time comparisons for M15 alignment, RSI, candle quality and explicitly specified H1 trend features. Record the exact predicate and interactions with loss-reset qualification. Keep broker, quote, protection and account-risk rules fixed. Compare incremental net results, costs, opportunity count, exposure and tail loss. Do not select historically winning pairs or tighten thresholds from the reviewed losing subgroup.

**Acceptance:** each comparison includes frozen v5 and full state replay, with every trial recorded. Overlapping price-derived confirmations must demonstrate incremental benefit before a change is proposed. Retaining the current gate is a valid result.

## M1 Develop a prospective net-R model

Begin with small regularized regression for policy net R and a training-only mean predictor as benchmark. Freeze features and a bounded tuning budget. Candidate inputs: setup type, normalized H1 slope/directional separation, volatility, entry/stop/target geometry, executable cost/stop and remaining holding time. The singleton v5 cohort cannot train or validate this model.

Actual broker outcomes, independently modelled setup outcomes and evolving portfolio returns are distinct labels. Record label kind, episode and attempt IDs. Use only information known at prediction time and the declared entry/exit/cost policy. A rejected order is not an actual loss. Record unavailable labels and purge training outcome overlap. Overlapping setup labels can measure quality but cannot be summed as achievable portfolio profit. Predictions/model identity remain separate from raw ADX `strength`, observed means and retrospective `expectedEdge`.

Evaluate rolling out-of-time calibration, residuals and ranking utility across periods, sessions and costs. A full exit-class probability model is a later option only if the simple model's limitations warrant it. Keep training, tuning, calibration and evaluation boundaries separate.

**Artifacts:** features/labels, fitting/evaluation scripts, model and feature hashes, training cutoff, candidate/config/data identity, prediction records and calibration reports under the research area.

**Acceptance:** reproducibility, no future-data leakage, comparison against a simple predictor, and full replay evidence of decision utility. Prediction accuracy alone does not justify trading changes.

## M2 Compare model selection with ADX priority

Compare current ADX order with predicted-net-R ranking over the same eligible opportunities, retaining exit priority and serialized execution. Analyze periods where capacity/margin actually binds. Selection/abstention is a separate registered policy after ranking evaluation; any cutoff is selected on training/validation evidence and frozen before final evaluation. Common-currency exposure adjustment is another measured variant, not an implicit new risk rule.

**Acceptance:** assess portfolio improvement, calibration and cost sensitivity together. Separate capacity/admission benefits from execution-timing or pricing effects: queue order can change final quotes/rejections even when all positions fit. Do not claim a score-only benefit when fills, timing and positions remain equivalent. Before any live model release, specify artifact loading, feature availability, deterministic ties, missing/failed-model behaviour and attribution. Model absence must not silently change entry permission.

## X1 Compare exits independently

Freeze entry rules and setup generation for each comparison; regenerate fills, eligibility and account state under each candidate exit policy. Holding observed fills fixed remains a conditional sensitivity, not portfolio returns. Register separate target, breakeven, initial-stop and holding-deadline experiments; inspect controlled interactions afterward. Use a small explicit candidate list derived from development evidence and retain failed variants. Resize whole units to stay at or below the same cash-risk budget after broker precision. Include winners/scratches/losers and opportunities displaced or created by changed holding time.

Reproduce broker protection and app polling when moving breakeven; a +1R candle touch does not prove an immediate stop update. Profile time-to-follow-through before specifying early exits. Sampled MFE cannot establish exact maxima or stop malfunction. Preserve prior trades' owner exit policies.

**Acceptance:** full account/portfolio results per policy and cost/order case, independent attribution and no duplicate spread deduction. Wider stops, larger targets and removed breakeven remain hypotheses, not predetermined improvements.

## X2 Evaluate SELL-to-BUY fades separately

Compare current fade eligibility with waiting for fresh normal continuation. Turning the fade off must not authorize the original stale repeat. Keep BUY-to-SELL fades disabled. Match outcomes by originating normal TP episode, including waiting opportunity costs and subsequent eligibility. Alternative reversal confirmation is a separately specified candidate.

Preserve executed BUY-side pricing/risk, parent TP ownership, one filled fade per episode, retry anchors, consumed state across restart, no recursive fade, no position displacement and no normal-signal reversal of a fade.

**Acceptance:** episode and portfolio reports plus wait/fill/local-decline/uncertainty/restart/consumption integration cases. Profitable trend results cannot conceal losing fade results, or vice versa.

## V1 Decide what the evidence supports

Report finalist baseline/candidate net AUD/net R, cost/intrabar sensitivity, paired period improvement, observable mark-to-market drawdown, exposure concentration, cadence and coverage. Use day/market-episode clusters for uncertainty and disclose effective independent-cluster counts. Preserve release/entry attribution and the complete trial ledger. [Backtest-overfitting research](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) and the [Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) explain why selecting the best historical trial requires additional scrutiny.

Distinguish software correctness, conditional historical performance and untouched prospective evidence. No fixed win rate, arbitrary trade count or 100-trade flag proves an edge. Register economic acceptance objectives before final evaluation. Contradictory, cost-sensitive or unresolved results remain inconclusive; negative results may reject a candidate. Retaining v5 while evidence accumulates is a valid deliverable. This is a research decision process, not a new runtime gate.

## L1 Prepare an explicitly selected live release

After evidence review, produce a concrete selected-change specification: exact entry/exit/model rules, compatibility/missing-evidence behaviour, affected consumers, preserved safeguards, attribution and tests. User selection/authorization precedes live behavioural implementation; research does not automatically promote a candidate.

Increment release/strategy/execution identity appropriate to actual scope. Preserve prior open-trade ownership/exits, enabled intent, settings and active cooldown deadlines. Validate through actual orchestration/broker-shaped fixtures, then appropriate backend regressions/frontend checks. Publication, builds and deployment need applicable user authorization and use the existing single-command workflow; no direct deployed-source edits.

After authorized delivery, verify revision, services, settings, broker exposure/protection, run identity and analytics. Evaluate naturally occurring results prospectively in the new cohort. No manual test orders, forced cadence or automatic switching is introduced.

## Implementation tracking

Implementation has started under the subsequent user authorization. Update each slice with evidence and remaining work; distinguish local completion from publication/deployment.

| Package | State | Evidence to retain |
| --- | --- | --- |
| A1 persisted cohorts | Locally validated; publication/deployment pending | [Persisted checks and delivery](2026-10-06-analytics-measurement-release.md) |
| A2 uncertainty | Locally validated; publication/deployment pending | [API/UI/report contract](2026-10-06-analytics-measurement-release.md) |
| A3 observed expectancy | Locally validated; publication/deployment pending | [Arithmetic and compatibility](2026-10-06-analytics-measurement-release.md) |
| R1 inputs/protocol | Audit/protocol tooling complete; H1/conversion/future freeze pending | [Research foundation](../../backend/research/README.md) |
| R2 replay | Architecture spike complete; full evaluator pending | [Spike and limits](evidence/2026-10-06/research/validation.json) |
| R3 v5 baseline | Planned | Baseline ledgers, assumptions/accounting |
| S1 structural BUY | Planned | Separate specs and portfolio comparisons |
| S2 indicator contribution | Planned | All ablation results |
| M1 prediction | Planned | Model/features and out-of-time calibration |
| M2 selection | Planned | ADX comparison and decision utility |
| X1 exits | Planned | Separate exit comparisons and bounds |
| X2 fades | Planned | Episode/portfolio comparisons |
| V1 evidence decision | Planned | Supported/rejected/inconclusive findings |
| L1 selected release | Conditional | User decision, release tests and delivery |

The original planning pass created documentation and reduced baseline evidence only. A1–A3 are now implemented under the subsequent request; the linked release record distinguishes validation, publication and deployment. R1 and the R2 architecture spike proceed offline in parallel, with full replay and candidate selection still pending.
