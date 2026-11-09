# Forex Trading Bot — repository instructions

Read the [Option C implementation record](docs/reviews/2026-11-09-option-c-operator.md) for current local work, published source and the last recorded production observation. Keep those facts separate; a saved observation does not establish present runtime state. Update that record when this work changes status instead of stacking checkpoints here.

## Permanent constraints

- Questions authorize answers only. Implement changes when Adam requests or authorizes them, within that scope.
- Use Node.js and the established shell tooling. Python is excluded from project source, research, analysis, tests, deployment and maintenance; retain historical evidence and its provenance.
- Run one live OANDA AUD account, one strategy and one active entry runtime. Offline research is separate from the product; retain the existing single-runtime operator surface.
- Preserve broker ownership, durable intents, real trade records, historical run/config identity and each position's owner-specific exit policy. New defaults must not change an old run's meaning. Behavioral releases increment release/strategy identity and retain prior cohorts.
- Broker/account truth wins over local caches. Uncertain exposure or protection blocks new entries while reconciliation and management continue. An entry pause also leaves position management running.
- Retain entry risk at or below 0.25%, the A$100 sizing-capital ceiling, the 0.5%-of-NAV aggregate stop-risk ceiling and existing margin, exposure and loss limits. Capacity is one position per pair, with qualifying different pairs allowed concurrently. Funding or risk-limit changes require an explicit user decision.
- Preserve saved enabled intent and active cooldown deadlines through maintenance and release changes. Activation permission differs from immediate entry readiness. A previously disabled instance remains disabled until the normal operator control enables it.
- Keep broker event time, validated receipt time, request duration, execution time and local observation time distinct. A successfully received unchanged OANDA event is usable under the existing receipt contract; its event age alone is not a health failure. Trace every consumer before changing a shared field's meaning, units or default.
- Preserve exact broker-price risk and movement limits, including binary-arithmetic boundary handling; formatting must not widen them. Preserve the first decision-price anchor for an eligible local pricing reconsideration, including across restart.
- The private internal-network dashboard, API, sockets and maintenance have no app login or operator token, by Adam's explicit decision. Broker credentials remain server-side and readiness/risk checks remain active.
- Automatic emails cover existing trade-open/close notifications. Operational health belongs in the dashboard/API. New authentication, notification categories, operational gates or strategy rules require a specific user instruction.
- Establish product intent, broker contracts and observed behavior before adding constraints. Report reproduced defects, hypotheses, software correctness and profitability evidence separately. Validate corrections through actual orchestration, including healthy edge cases; use isolated fixtures rather than manual test orders.

## Contracts to consult when changing behavior

- **Operator controls, dashboard observations, reconnects or command results:** read the [Option C operator interface and invariants](docs/reviews/2026-11-09-option-c-operator.md). The backend owns readiness and entry intent; the client owns display ordering and transport lifetime. Preserve partial-source evidence, accepted command results and display-only publication ordering.
- **H4 entries, exits or configuration:** read the [H4-v1 release contract](docs/reviews/2026-10-18-h4-channel-release.md) and [H4-v2 peak protection contract](docs/reviews/2026-10-26-h4-peak-profit-release.md). Retain v1 channel-only owners, immutable initial risk, durable executable-price peaks, unchanged receipt semantics and monotonic broker protection.
- **Historical M15 owners, attribution or replay:** read the release matching the owner: [v6 BUY retest](docs/reviews/2026-10-07-buy-retest-release.md), [v5 SELL retest](docs/reviews/2026-10-01-sell-retest-release.md), [v4.2 loss reset](docs/reviews/2026-09-30-loss-reset-release.md), [v4.1 pair capacity](docs/reviews/2026-09-28-pair-capacity-release.md) or [integrated v4](docs/reviews/2026-09-26-integrated-release-specification.md). The integrated contract defines normal/fade episode ownership and post-exit evidence; historical `brokerClosedAt` alone cannot prove a later signal. [Historical close-time recovery](docs/reviews/2026-10-17-historical-close-evidence-recovery.md) preserves the separate proof.
- **Pricing, health, retries or maintenance:** read the [quote-freshness correction](docs/reviews/2026-09-08-quote-freshness-fix-plan.md), [maintenance/quote-boundary correction](docs/reviews/2026-09-10-maintenance-and-quote-boundaries.md) and [entry reconsideration contract](docs/reviews/2026-09-11-entry-rejection-and-reconsideration.md). Only the three named pre-submission pricing rejections can reconsider on an existing scan; submission, uncertainty, fills and other rejection types retain suppression.
- **Analytics or research:** read the [measurement release](docs/reviews/2026-10-06-analytics-measurement-release.md), [offline research instructions](backend/research/README.md) and relevant dated protocol. The [v6 viability review](docs/reviews/2026-10-17-strategy-viability-review.md) measures the retired M15 rules, not H4. Correctness tests do not establish positive expectancy, a trade quota or permission to tune a strategy.
- **Deployment, backup or restore:** read the [one-command deployment guide](scripts/DEPLOYMENT_README.md) and [recovery reference](docs/operations/recovery-and-access.md). Preserve their demonstrated checks and distinguish offline verification from a production recovery drill.

## Local work and delivery

Develop, edit and test in a local checkout/worktree. Delivery is one way: local commits → GitHub publication → the existing deployment command (`./scripts/deploy.sh` locally, `./scripts/update.sh` on the Pi). Production consumes published revisions; source hotfixes, staging/committing there and reverse code sync are excluded.

Adam subsequently authorized committing and pushing both engineering passes and deploying them with the standard deployment script on November 9. This release follows local commits → GitHub → `./scripts/deploy.sh`, preserving the script's broker checks and previous entry intent. Except for explicitly authorized work, Adam manages `git add`, commits, pushes, frontend/production builds, deployment scripts and production restarts. Earlier release-specific permissions remain scoped to their recorded work.

Backend tests, isolated fault reproductions, syntax/lint checks and dependencies needed for local tests are appropriate. Use Node `>=20 <23`, pinned by `.nvmrc`, with matching native SQLite ABI. Keep tests separate from production databases and broker credentials. Read-only SSH remains authorized at `adam@img.oakroad:/opt/forex-trading-bot` for diagnosis; implement any correction locally.

Record finding → change → rationale → checks → remaining work in the dated work record. Update operator docs when behavior changes, and mark local completion, publication and observed deployment separately. Existing unresolved operational or research work stays open unless evidence establishes completion.

## Historical reference

For original release-specific authorizations or older checkpoints, consult the [complete pre-cleanup snapshots](docs/archive/2026-11-09-top-level-checkpoints.md). [Earlier instructions and incidents](docs/archive/CLAUDE_HISTORY_BEFORE_2026-09-06.md), [project history](PROJECT_HISTORY.md) and dated review evidence retain their original provenance; superseded checkpoints do not override the permanent constraints or a later explicit user instruction.
