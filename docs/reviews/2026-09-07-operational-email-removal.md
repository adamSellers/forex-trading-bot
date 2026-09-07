# September 7 operational-email removal

Status: **implemented locally; publication and deployment pending**. Production was last verified at `788a725` at 13:56 AEST on September 7. That deployed version still contains the email path. The user manages publication and the single deployment command, `./scripts/deploy.sh`.

## Finding and cause

The September 6 remediation introduced automatic operational warning/recovery emails and reused `enableEmailAlerts`, the existing trade-email setting. This expanded the user's notifications without a separate decision. Production logs contained 18 warning/recovery pairs (36 emails) on September 7 by the inspection time. The user's pictured messages specifically reported unavailable or stale broker prices; the subject-only logs do not establish that every earlier pair had the same cause.

The health monitor sampled once a minute, considered any instrument with a broker price-event timestamp older than 20 seconds stale, and sent a warning after the same issue key remained present for at least 60 seconds of observations. Successful HTTP polling can still return an older broker quote, and different stale instruments shared `STALE_PRICE_DATA`. One clear sample sent a recovery and removed the announced incident, allowing another warning/recovery pair. Persisting active incidents did not prevent repeated cycles. An isolated reproduction using the actual data freshness and health services generated four mocked emails in five simulated minutes while HTTP fetch timestamps and broker reconciliation remained current.

At the production inspection, operational health was healthy, all four price feeds and eight candle sets were fresh, broker reconciliation was current, and there were zero open positions or pending intents. These emails did not by themselves establish a disconnected broker or stopped process. The notification behavior was too noisy and was an inappropriate expansion of the trade-email feature.

## Correction and retained behavior

- Removed the operational email method and both warning/recovery subjects, including notifications for critical health issues.
- Removed email and state-store dependencies, incident announcement persistence and recovery/rearm logic from the health monitor. Existing historical notification-state rows are unused; no database deletion or migration is required.
- Removed the operational-email status field from the health API and its dashboard label.
- Kept dashboard/API health snapshots, periodic checks, stale-data checks, broker reconciliation, protective-order checks, entry readiness and risk limits unchanged.
- Kept existing trade-open/close notifications and the manual test-email method. No new notification option or cooldown was introduced.

Current repository instructions record that operational health belongs in the dashboard/API and that the existing trade-email setting must not be reused for new notification categories without explicit user instruction. This correction does not change strategy parameters, funding, risk limits or cohort identity.

## Verification

Targeted verification passed 32 tests across four suites: repeated warning/critical/recovery transitions with no emails or incident-state writes; continued critical-health visibility; check failure/recovery, concurrency and timer lifecycle; actual server construction without mail/state dependencies; route health checks; and existing trade-open/close delivery through mocked SMTP.

Full verification: **511/511 backend tests passed across 34 suites** on Node 20.20.2. The changed dashboard JSX parses, and `git diff --check` passes. Source review confirms that the operational email method, subjects, incident-state key and alerting metadata no longer exist in production code; obsolete dependency names remain only in regressions asserting they have no effect. All fixtures are isolated; no real email, broker order, production mutation, frontend build or deployment was performed.
