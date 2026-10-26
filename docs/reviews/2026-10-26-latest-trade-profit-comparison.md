# Latest trade: 20.1 pips and A$0.0463 — 26 October 2026

The latest USD/JPY SELL 3550 is correctly reported as **A$0.05** after rounding.
Its wider H4 stop produced a much smaller position than the earlier M15 trades,
so each pip carried less cash value. No discrepancy was found between the
recorded fills, broker accounting, stored net profit and dashboard rounding.

All dates below are Sydney AEDT; dates identify the close.

| Trade | Units | Initial stop | Initial AUD stop risk | Realized pips | Net AUD |
| --- | ---: | ---: | ---: | ---: | ---: |
| USD/JPY SELL 3550, 24 October | 28 | 72.1 pips | 0.1851 | +20.1 | +0.0463 |
| AUD/USD BUY 3529, 22 October | 36 | 34.9 pips | 0.1814 | −1.6 | −0.0102 |
| EUR/USD BUY 3519, 7 October | 148 | 7.9 pips | 0.1690 | −7.9 | −0.1691 |
| USD/JPY BUY 3497, 1 October | 134 | 14.5 pips | 0.1783 | −14.5 | −0.1787 |

The older EUR/USD loss consumed its full initial stop, approximately −1R.
The latest 20.1-pip gain covered only 27.9% of its 72.1-pip initial stop;
after financing its net result was +0.2501R. Initial cash risks remained similar.
Even the same-pair comparison shows the change: 134 USD/JPY units previously,
versus 28 now. Pips alone cannot compare cash returns across these positions.

The established sizing contract uses 0.25% of the smaller of 80% available margin
and A$100. Units are the whole-unit floor of cash risk budget divided by
submitted-stop distance times quote-to-AUD loss conversion, with final fill and
margin checks. The H4 release uses a 2×H4 ATR stop; the October 7 M15 trade used
1.25×M15 ATR. A wider stop reduces units while preserving the cash-risk budget.
This review verified recorded initial risks; it did not reconstruct each exact
entry-time account/risk-budget snapshot.

Trade 3550 sold 28 USD at 157.041 JPY/USD and bought them back at 156.840:

- Price movement: `(157.041 − 156.840) × 28 = JPY 5.628`.
- Broker gain conversion: `5.628 × 0.008973243526 = A$0.0505014`, recorded as A$0.0505.
- Cumulative overnight financing: −A$0.0042; commission and guaranteed execution fees: zero.
- Net: `A$0.0505 − A$0.0042 = A$0.0463`, displayed as A$0.05.

Spread and execution effects are already reflected in the actual entry/exit
prices; the broker's half-spread-cost attribution must not be deducted again.
The close fill's financing field is zero, while the closed trade's cumulative
financing is −A$0.0042. The app correctly uses cumulative financing. OANDA
documents these separate fields in its [trade definitions](https://developer.oanda.com/rest-live-v20/trade-df/)
and [transaction definitions](https://developer.oanda.com/rest-live-v20/transaction-df/).

The trade closed at **07:45:07 AEDT on Saturday 24 October**, the configured
Friday 16:45 New York weekend exit. Retained in-lifetime executable quote samples
had reached +95.6 pips, approximately +1.326R, before the final +20.1-pip exit.
That is a separate exit-performance observation. It does not demonstrate that a
new target, breakeven rule or trailing threshold would improve the strategy.

## Follow-up: why trailing did not protect the gain

The position's immutable `H4_CHANNEL` owner had channel trailing enabled, using
10 completed H4 candles. Conventional distance-from-best-price trailing and
automatic breakeven were disabled. For a SELL, the channel candidate is the
**highest ask high** of those 10 candles. A candidate only replaces the broker
stop if it is lower, tightening protection. Profit alone does not activate a
second exit policy.

Re-running the actual `evaluateChannelTrail` function over the retained 80-bar
broker-normalized candle snapshot, at entry and every subsequent completed H4
boundary before close, produced candidate prices from **158.400 down to
158.186**. Every candidate was above the tighter initial broker stop **157.762**,
so none could ratchet it. The separately captured October 23 observation
contemporaneously confirms the final 10 ask candles, candidate 158.186 and
broker stop 157.762. This reconstruction establishes candidate geometry; it is
not a complete management-loop execution trace.

The best retained executable ask was **156.085 at 11:39:23 AEDT on October 23**,
95.6 pips below entry. The final buyback at 156.840 surrendered 75.5 pips,
approximately 79% of that sampled favorable move. The stop had never locked in
profit, including after the trade exceeded its original 72.1-pip risk distance.
The observed outcome is consistent with the released slow channel rule. No
missed tighter channel candidate was demonstrated. Protecting profits relative
to the best observed price would require a distinct exit-rule change; this
follow-up introduced no new trigger or distance.

## Alternatives discussed with Adam

Adam prefers stronger profit protection. The first candidate worth evaluating
is a hybrid retaining the channel while adding a tightening-only stop tied to
the favorable executable price since entry. Illustrative activation at +1R and
a 0.5R trailing gap would have reached approximately +59.5 pips of price-profit
protection on trade 3550; a 0.75R gap would have reached approximately +41.5.
Here R is the immutable original 72.1-pip stop distance, not the current stop.
These example parameters were chosen after seeing the trade and are not
validated settings or a profitability recommendation.

The [illustrative mechanics screen](evidence/2026-10-26/illustrative-exit-mechanics.json)
walks retained executable quote samples in time order and records the first
observed crossing after activation. It does not reconstruct broker update
acknowledgment or exact stop fills, deduct changed costs, or replay the later
portfolio. In that screen, a +1R price-breakeven rule was eventually crossed
near zero. It would not retain a meaningful part of the favorable move.
A five-bar channel reconstruction still had every candidate above the short
entry price, so shortening the channel alone did not create profit protection
on this example.

Other candidates are a volatility-adaptive ATR trail from the favorable
executable extreme, or a floor retaining a fraction of sampled peak profit.
An ATR trail needs an explicit volatility/update convention and no-loosening
rule. At unchanged entry volatility, a 2 ATR gap on this trade would span
approximately 72.1 pips and leave only about +23.5 pips at the sampled peak.
An ATR label alone therefore does not ensure the protection Adam wants.

Ranking candidates requires broader chronological H4 outcomes, including normal
retracements that later produce large winners, actual costs, bid/ask execution
and the new entries made possible by earlier exits. Existing intraday research
does not measure the H4 candidate. No new live exit setting was selected or
implemented by this discussion.

The [reduced evidence](evidence/2026-10-26/latest-trade-profit-comparison.json)
records a fresh production API read, selected persisted broker records, conversion
arithmetic and verification results. Four trades passed fill/pip/net/cash-risk
checks; both H4 outcomes also matched independently retained October 25 broker
evidence. This review did not complete a fresh independent OANDA request.
Production remained at clean `c09efb5`; no runtime, trading rules, settings,
orders, publication or deployment changed. Only this local review and its reduced
evidence were added.
