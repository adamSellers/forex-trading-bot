# Forex Trading Bot — repository instructions

## Authoritative current state

This is one live OANDA AUD account and one `intraday_momentum` runtime. Read-only SSH on September 11 verified user-deployed revision `33e0b76`, release `m15-intraday-v3.2`, strategy `1.1.2`, including the maintenance and quote-limit correction. Local v3.3 / strategy 1.1.3 contains the approved [entry-rejection and reconsideration correction](docs/reviews/2026-09-11-entry-rejection-and-reconsideration.md), locally validated with 713 backend tests passing; awaiting user publication/build/deployment. September 8 trade inspection verified a six-hour Time Stop through the live engine; see the [exit-policy observations](docs/reviews/2026-09-08-exit-policy-observations.md).

Read these documents before changing trading behavior:

- [README.md](README.md) and [USER_GUIDE.md](USER_GUIDE.md).
- [September 6 production review](docs/reviews/2026-09-06-production-review.md): immutable evidence from the read-only audit.
- [September 6 remediation register](docs/reviews/2026-09-06-remediation.md): accepted changes, justification, verification and delivery status.
- [project_roadmap.md](project_roadmap.md): current implementation checkpoints.
- [PROJECT_HISTORY.md](PROJECT_HISTORY.md): completed milestones with explicit deployment state.

## Permanent constraints

- One live strategy, one active entry runtime, no simulated execution subsystem, no strategy promotion/switching interface.
- This is a private personal tool available only on the user's internal network. The user explicitly removed the operator login requirement on 2026-09-07. Dashboard, API, sockets, startup and ordinary maintenance require no app login or operator token. Do not reintroduce accounts, sessions or access gates as general remediation; broker credentials and trading risk checks remain required.
- Automatic emails cover the existing trade-open/close notifications only. Operational health belongs in the dashboard/API; do not reintroduce warning/recovery emails or reuse the trade-email setting for new notification categories without explicit user instruction. Keep health, readiness and risk checks active.
- No manual test orders. Use isolated mocks/fixtures to test failures and lifecycle integration.
- Preserve broker ownership, durable intents, historical run/config attribution and real trade records.
- Broker/account truth wins over local caches. Uncertain exposure or protective orders must stop new entries while reconciliation/management continues.
- Keep entry risk at or below 0.25%, sizing-capital ceiling A$100, and one concurrent position. Funding or limit increases require a separate explicit user decision; September 6 work does not authorize either.
- Each behavioral release increments release/strategy identity and retains prior cohorts. Fixes must be demonstrated through the live orchestration path, not only isolated helper tests.

## Authorized September 6 work

The user approved implementation of the review findings and requested documentation of every change and its justification. Complete the authorized local remediation, record verification results and unresolved limits, and keep production unchanged. Do not reinterpret statistical hypotheses in the report as approval to tune entry indicators or select retrospectively winning pairs/sides.

## Git, build and production workflow

The workflow is strictly one way: local development → local commits and publication to GitHub → deployment from GitHub to the bot. Never stage, commit or push source from the production machine, reverse-sync its code into GitHub, or edit deployed source as a hotfix. Diagnose there when authorized, implement locally, and use the same deployment path for every release. This is also the user's standing rule for all projects.

The user manages Git publication, builds and deployments. Do not run `git add`, `git commit`, `git push`, frontend/production builds, deployment scripts or production restarts. The user-facing deployment is one command after Git publication: `./scripts/deploy.sh` from the local checkout (`./scripts/update.sh` on the Pi). Keep setup, staging and checks in the scripts; do not turn normal deployment into a manual runbook. Read-only SSH is authorized at `adam@img.oakroad:/opt/forex-trading-bot`; never edit deployed source directly.

Backend tests, isolated fault reproductions, syntax/lint checks, dependency installation needed for local tests and local source/documentation edits are appropriate. Use Node >=20 <23 (pinned `.nvmrc`); native SQLite must match Node's ABI. Never point a test at the production database or load broker credentials into a test process.

## Documentation and checkpoints

Keep the remediation register current with finding → change → rationale → tests → remaining work. Update user-facing docs when behavior changes. Mark code completion separately from deployment. Checkpoints preserve context; do not silently drop remaining authorized work. Historical instructions and old strategy decisions are historical evidence, not current policy.

## User-requested follow-up: take-profit tuning

On September 8 the user explicitly asked to keep the fixed 1.5R take-profit parameter under review as more real trades accumulate. Carry this question into future performance reviews; it is not authorization to change the target or enable trailing stops. September 7's three USD/JPY targets earned A$0.8024 but preceded a further sharp decline; record both uncaptured continuation and gains protected from later reversals. Compare net R, holding time, sampled excursions, costs and re-entry restrictions across all relevant trades, preserving run identity and the one-position limit. Existing excursion sampling ends when a trade closes; post-exit paths require separately available market data and must not be presented as already recorded telemetry. One striking trend day does not establish an optimal target. The [roadmap](project_roadmap.md) and [observation record](docs/reviews/2026-09-08-exit-policy-observations.md) retain the evaluation criteria.

## September 11 entry rejection and reconsideration correction

The user approved correcting expected local pricing declines counted as system errors, double-counted unexpected errors, and same-candle suppression after a confirmed local decline. Reconsider only `SPREAD_TOO_WIDE`, `COST_TO_STOP_TOO_HIGH` and `ENTRY_PRICE_DEVIATION` outcomes that occurred before any order submission, on the next existing scan while the same setup still qualifies. Preserve the first decision-price anchor and its existing movement bound across attempts and restart through the existing durable decision records. Submission, uncertainty, fills and other rejection types retain suppression. Do not add a rapid retry loop, widen limits, change costs/risk/strategy thresholds or reset an anchor to chase the market. The [implementation record](docs/reviews/2026-09-11-entry-rejection-and-reconsideration.md) separates observed cached-price opportunities from unproven executable fills and records delivery state. The v3/v3.1/v3.2 migration preserves saved settings and enabled intent.

## September 10 maintenance and quote-limit correction: deployed

The user approved fixing the demonstrated backup/cooldown pause and exact quote-boundary rejections. Preserve enabled intent during maintenance while enforcing the original cooldown deadline at entry; distinguish activation permission from immediate entry readiness. Carry only an active cooldown through a release change, using existing run metadata; never clear or restart it merely by deploying. Preserve historical ownership and incomplete-streak isolation between cohorts. Numerical comparisons account for binary arithmetic error without widening trading limits or rounding broker prices. The v3/v3.1 upgrade preserves saved settings. The linked implementation record tracks justification, integrated validation and delivery state. An already-disabled production instance stays disabled until the user enables it through the normal dashboard control.

## September 8 quote-freshness correction: deployed

The user approved the full [quote-freshness correction](docs/reviews/2026-09-08-quote-freshness-fix-plan.md) on September 8, requiring each change to be justified, validated and minimal. User deployment of `d46da61`, `m15-intraday-v3.1` / strategy `1.1.1`, was verified read-only on September 10. The correction covers health, cached/final entry, pre-submission checks, management, conversions, telemetry and deployment-health verification; publication/build/deployment remain user-managed. Normal repeated OANDA events received in successful current responses are not by themselves a bot-health failure. Keep broker event time distinct from validated receipt and elapsed request time; changing a shared field's meaning requires tracing every consumer. Global Codex instructions in `~/.codex/AGENTS.md` record the user's cross-project lesson about evidence, scope and behavioural impact. Preserve the existing risk/strategy settings and historical semantics when implementing an approved correction.

## Historical archive

The previous CLAUDE.md, including earlier incidents and retired architectures, is preserved in [docs/archive/CLAUDE_HISTORY_BEFORE_2026-09-06.md](docs/archive/CLAUDE_HISTORY_BEFORE_2026-09-06.md). It must not override these current instructions.
