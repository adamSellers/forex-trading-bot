# Historical broker close evidence recovery

The October 17 viability review found two historical initial-stop anchors whose records said RECONCILED but lacked the explicit broker close-time proof required by the existing H1 reset policy. Normal broker sync revisited open trades only, leaving these closed anchors unavailable indefinitely.

Authenticated read-only OANDA GETs recovered matching CLOSED records for AUD/USD BUY 2867 and GBP/USD BUY 2858. Their close times are June 1 at 13:21:31.252307297 UTC and May 28 at 00:55:35.281739993 UTC. The [minimal capture](evidence/2026-10-17/recovered-close-proof.json) excludes account identifiers, credentials and financial fields.

## Correction

The existing serialized broker reconciliation loop now identifies only the latest armed same-pair/same-side historical anchors lacking confirmed close time. It retrieves the matching broker trade and persists separately attributable close-time evidence and its source response. Wrong IDs, open trades, absent/unparseable times, contradictory provided instrument/direction, and lookup or persistence failures leave the existing reset policy blocked.

Original outcomes, timestamps, entry telemetry and ownership remain intact. The existing H1 reset and break/retest requirements still decide entry eligibility. No strategy parameter, risk limit, episode definition, release identity or live cohort is changed by this evidence repair.

The earlier diagnostic found 152 affected scans across 30 pair/candle observations; all also lacked ready retest patterns. Recovery corrects unavailable evidence but does not demonstrate that any v6 fill was missed or that the strategy is profitable.

## Validation and delivery

Local Node 22.23.1 validation passed 1,336 backend checks across 68 suites: 1,326 passed in the restricted run; the ten API/Socket.IO checks passed separately with loopback enabled after the sandbox rejected listening on 127.0.0.1. Focused recovery validation passed 403 checks across seven suites.

The actual coordinator, generator and entry engine accept recovered authentic-shaped proof followed by observed H1 neutral/requalification and a valid BUY pattern. Missing pattern or H1 reset remains HOLD. Failure cases cannot authorize entry. Repeated sync does not refetch already recovered proof.

The user explicitly approved local publication and the standard deployment on October 17. Local commit **519b428** was published to GitHub main and deployed with ./scripts/deploy.sh. The target passed all 1,336 backend checks across 68 suites, built the frontend, verified matched backup **20261017_171918**, and restored enabled intent. No production source was edited, committed or pushed manually.

Read-only verification at **17:23 AEDT** confirmed clean 519b428, healthy services, strategy 1.4.0, the original live run, enabled intent and no positions or unresolved orders. Balance remained **A$95.093**. Both historical rows contain separately attributable broker close-time proof; their old exit_time and broker_closed_at values are unchanged. The existing reset evidence for both directions has observed neutral and later qualifying H1 candles. The [deployment verification](evidence/2026-10-17/recovery-deployment-verification.json) retains reduced observations. The viability analysis remains separate from this recovery release.

