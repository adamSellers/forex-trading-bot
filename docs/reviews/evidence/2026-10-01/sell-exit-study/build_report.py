#!/usr/bin/env python3
"""Render the dated research note from retained, checked study results."""
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = Path(__file__).resolve().parent
data = json.loads((BASE / 'exit_results.json').read_text())
trades = json.loads((BASE / 'exit_inputs.json').read_text())
recent = [t for t in trades if t['primary']]
names = {'STOP_LOSS': 'SL', 'BREAKEVEN_STOP': 'BE', 'TAKE_PROFIT': 'TP',
         'TIME_STOP': 'Time', 'SESSION_CLOSE': 'Session'}


def money(n):
    return f'{n:+.4f}' if abs(n) > 1e-10 else '0.0000'


def summary(cohort, family, m, mode='poll_0', key='cash_proxy_aud'):
    r = next(r for r in data['aggregates'] if r['cohort'] == cohort and r['family'] == family
             and r['multiplier'] == m and r['mode'] == mode and r['subset'] == 'all_trades')[key]
    return money(r['low']) if abs(r['low'] - r['high']) < 1e-8 else money(r['low']) + ' to ' + money(r['high'])


def cell(t, family, m):
    r = next(r for r in data['results'] if r['id'] == t['id'] and r['family'] == family
             and r['multiplier'] == m and r['mode'] == 'poll_0')
    low, high = min(o['cash_proxy_aud'] for o in r['outcomes']), max(o['cash_proxy_aud'] for o in r['outcomes'])
    val = money(low) if abs(low - high) < 1e-8 else money(low) + '…' + money(high)
    return '/'.join(sorted({names[o['kind']] for o in r['outcomes']})) + ' ' + val


def individual_table(rows, family):
    out = ['| Trade · Sydney entry | Pair | Actual exit / net AUD | 1.25× stop | 1.5× stop | 2× stop |',
           '| --- | --- | ---: | ---: | ---: | ---: |']
    for t in rows:
        date = datetime.fromtimestamp(t['entryTime'] / 1000, ZoneInfo('Australia/Sydney')).strftime('%b %d %H:%M')
        out.append(f"| {t['id']} · {date} | {t['instrument'].replace('_', '/')} | {names[t['exitReason']]} {money(t['pnlAud'])} | " +
                   ' | '.join(cell(t, family, m) for m in (1.25, 1.5, 2)) + ' |')
    return '\n'.join(out)


aggregate_table = '\n'.join(
    '| ' + ('Original policy, model benchmark' if m == 1 else f'{m:g}× initial stop') + ' | ' +
    ' | '.join(summary(c, f, m) for c, f in [('recent', 'fixed'), ('earlier', 'fixed'), ('all', 'fixed'), ('recent', 'scaled'), ('all', 'scaled')]) + ' |'
    for m in (1, 1.25, 1.5, 2))

report = f'''# SELL entries, exits and wider stops — 1 October 2026

**Wider stops change some of these outcomes; they do not rescue all the SELL losses.** In the recent sample, widening only the initial stop while retaining the original target and breakeven trigger turns three of eight full-stop losses into profitable exits at 2× width. Three still hit their doubled stops, and two still close at a loss under the time/session rules. Moving the target and breakeven trigger farther away with the stop is a different policy and can make results worse.

This research changes no trading code, settings, positions or deployment. The separately completed chart correction remains local. Broker actuals below are facts; alternative results are **independent historical quote sensitivities**, not alternative account or portfolio P&L.

## Scope and observed exits

The primary cohort is every SELL entered after the prior September 21 10:35 UTC review cutoff: **13 trades, ten negative, two positive, one exactly flat; net −A$0.8769**. The entries occurred September 22–30 Sydney time. Nine are v3.3, three v4.1 and only one v4.2. They are not thirteen tests of the current release.

- Eight initial-stop losses: −A$1.3592.
- Two broker-confirmed breakeven exits: A$0.0000 and −A$0.0011; the latter is a small execution loss at the protected stop.
- One session-close loss: −A$0.0469.
- Two target winners: +A$0.5303 combined.

The earlier control cohort contains all sixteen SELLs since September 6 before that cutoff, actual net **+A$0.0735**. All 29 SELLs together realized **−A$0.8034**. Every retained SELL has SELL source signal, SELL fill and recorded H1 short regime; none is a post-target fade. Closed trades, entry/exit prices, units and realized net were independently reconciled with OANDA.

## What was tested

The observed entry time and executable bid fill stay fixed. Alternative initial stops are **1.25×, 1.5× and 2× the actual rounded broker stop distance**. Whole-unit position sizes are reduced so the initial cash risk does not exceed that trade's original broker-stop risk. This preserves historical risk, not a newly increased account budget.

Two exit families are compared:

1. **Fixed target and breakeven:** retain the original broker target and original +1R breakeven price; widen only the initial stop. At 2× width the old approximately 1.5R target becomes approximately 0.75 of the new R, and the old BE trigger becomes approximately 0.5 of the new R. Smaller size reduces winning payouts.
2. **Scaled target and breakeven:** move the target to 1.5 times the new rounded stop distance and BE to +1 new R. This retains the intended reward/risk ratio but delays protection and asks for a larger favorable move.

Both retain each trade's saved **six-hour maximum and New York 16:45 session close**, whichever comes first. A neutral H1 regime is not invented as an exit. No actionable BUY/short-exit reversal appears on the retained same-pair signal tapes within the studied windows; recent COOLDOWN records are suppressed duplicate SELLs. Future strategy/reentry state is not regenerated.

All alternative AUD numbers are **cash proxies**, using entry-time OANDA gain/loss quote-to-AUD conversion and nominal stop/target fills, with adverse candle-open gaps accounted for. They exclude unknown alternative execution slippage, future conversion changes and financing. Ask prices already include the exit side of the spread; spread is not subtracted again. The actual column uses broker-realized net instead.

## Every recent trade: widen the initial stop only

SL = initial stop; BE = protected breakeven stop; TP = target. Time and Session retain the existing deadlines. Alternative cells show exit type and approximate AUD with reduced units. The three actual nonnegative trades are deliberately retained as controls.

{individual_table(recent, 'fixed')}

At 2×, the rescued full-stop losses are **3347, 3393 and 3487**. **3435, 3455 and 3465 still hit full stops**. 3425 survives its initial stop but loses at six hours; 3445 survives but loses at session close. 3413 remains a losing session exit. 3475 remains a nominal breakeven scratch: removing its observed A$0.0011 execution loss from the proxy is not a newly discovered trading win.

The recent winning controls also shrink: 3369 and 3381 together fall from an original-policy model payout of +A$0.5218 to +A$0.2603 at 2×. Counting only rescued losing trades would hide that cost.

## Changing the entire risk unit produces a different answer

{individual_table(recent, 'scaled')}

Delaying BE turns **3357 and 3475** from protected scratches into full losses in the sampled-poll model. Original winner **3381** becomes a breakeven scratch at 1.25× and 1.5×, though 2× reaches its farther target. Results need not improve monotonically with stop width because protection, targets and deadlines interact.

An immediate-touch BE sensitivity scratches 3357 at scaled 1.25× instead of stopping it; the actual app polls, so that favorable historical touch cannot be assumed to have produced a successful order update. This single distinction moves the recent scaled-1.25× proxy from −A$1.0297 to −A$0.8528.

## Conditional sums and earlier controls

**These sums hold every observed entry fixed, even when extended positions overlap later entries. They are not portfolio returns.** Compare alternatives with the model benchmark in the first row; broker actuals differ slightly because the model does not reproduce exact execution or future conversion.

| Stop width | Recent 13, fixed exits | Earlier 16, fixed exits | All 29, fixed exits | Recent 13, scaled exits | All 29, scaled exits |
| --- | ---: | ---: | ---: | ---: | ---: |
{aggregate_table}

All values above are approximate AUD with original cash risk preserved. Actual observed net was −0.8769 recent, +0.0735 earlier and −0.8034 overall; model benchmarks are approximately −0.8838, +0.0612 and −0.8226.

The fixed-exit 2× policy nearly erases the recent independent-trade loss, but it changes the earlier cohort from a small profit to **−A$0.3009**. None of the tested all-29 conditional sums is positive. The near-flat scaled-2× all-29 result is especially sensitive to BE timing: immediate-touch protection converts earlier winner 3085 into a scratch and worsens that sum to approximately −A$0.30. These are small, mixed-release historical cohorts, with no out-of-sample evidence establishing a profitable policy.

Keeping the original position size instead raises initial cash exposure roughly in proportion to stop width. For the recent sample, fixed-target/BE proxies become **−A$0.6463 / −A$0.3762 / −A$0.0775** at 1.25× / 1.5× / 2×. Scaled-target/BE proxies become **−A$1.2970 / −A$1.2853 / about −A$0.8780**. This research does not authorize increased live cash-risk limits.

Removing BE is not a general cure either. With original target and a 2× stop, the recent reduced-size sum worsens from −A$0.0373 with BE to **−A$0.3894 without BE**. The two scratches become losses. Conversely, some farther-target paths benefit from delayed protection; that mixed effect is why BE, target and initial-stop placement must be evaluated separately.

## Latest AUD/USD 3487

The actual SELL filled at **0.69559**, with stop **0.69640**, target **0.69437**, and closed at **0.69642** for −A$0.1758. During its real lifetime it did not reach its +1R BE trigger; the retained sampled best excursion was +0.519R and wholly contained S5 ask candles reached approximately +0.531R.

A 1.25× submitted stop rounds to **0.69660**. The retained ask path through the six-hour deadline peaks at approximately **0.69651**, so this candidate survives the rebound. At the deadline, October 1 **05:45:51 AEST**, the model's latest ask is **0.69461**: about **+9.8 pips**, approximately **+A$0.1632** with units reduced from 146 to 117. The S5 historical quote path cannot establish the exact hypothetical market fill.

It is a **profitable time exit, not a target hit**. The original target first touches around 06:03 AEST, after the six-hour deadline. The initial stop can therefore explain losing this particular otherwise favorable later move, without treating every subsequent decline as one the bot was permitted to hold for.

## What the setups show

The [setup audit](evidence/2026-10-01/sell-exit-study/setup_findings.md) preserves all thirteen recent entries, indicator values, trigger combinations, filled-entry distances and release context.

- Initial-stop losses span filled entries **0.35–2.37 ATR below M15 EMA20**; the winning controls were **2.73 and 1.40 ATR below**. Latest AUD/USD was 2.10 ATR below. Distance below EMA alone does not separate winners from losers.
- Five recent pullback-only SELLs lost **A$0.7049**, but seven earlier pullback-only SELLs gained **A$0.2904**, including four positive results. The pullback definition changed between these releases; no blanket branch removal follows from this sample.
- Six of eight recent full stops had verified sampled favorable excursion below +0.5 original R. They often lacked early follow-through; the chart's later direction does not prove the original trade reached a management threshold while alive.
- Historical EUR/USD 3393 entered only **3.95 minutes after winner 3381**, using the old v3.3 reentry behavior. The later freshness change must not be retroactively described as bypassed by that trade.
- Latest AUD/USD used a qualifying breakout, while its revised pullback test failed. The H1 loss-reset requirement had rearmed **63.76 hours earlier**. It establishes an intervening H1 regime reset, not a newly completed local pullback just before entry.

The [structural-stop supplement](evidence/2026-10-01/sell-exit-study/setup_structure.json) finds **11 of 13 original stops inside the preceding four-bar midpoint range**, including six of eight full-stop losses and both target winners. For latest AUD/USD, the stop was 5.52 pips below signal EMA20 and 23.8 pips below the preceding high at 0.69878. Entry-to-that-high distance is 31.9 pips, or **3.94× its original 8.1-pip stop distance**. Testing factors through 2× therefore does not test a stop beyond that structure. These comparisons establish geometry, not the frequency of a normal retracement or proof that a structural stop improves returns; midpoint structure also differs from ask-triggered protection. No structural buffer or individually optimized stop was invented.

## Execution and portfolio limits

The source is **102,732 completed OANDA S5 bid/ask candles**, 29 broker closed-trade records, 424 broker transactions and saved same-pair signal windows. Candles are checked for order, uniqueness and valid OHLC. OANDA defines candle timestamps as interval starts and OHLC as aggregate prices; intra-interval event ordering is not supplied. See [OANDA candle definitions](https://developer.oanda.com/rest-live-v20/instrument-df/) and [order trigger definitions](https://developer.oanda.com/rest-live-v20/order-df/).

The model examines both high-first and low-first paths, bounds a deadline inside a candle, and compares ten-second BE polling at two five-second phases. The latest completed candle quote is carried through empty S5 intervals; an unchanged quote is not treated as a service failure. Neither phase changes terminal prices/classes in this retained sample. Immediate-touch and no-BE cases are separate policy sensitivities, not claims about actual management.

The original-policy model reproduces **29/29 exit classifications**, but **does not reproduce exact broker trigger times or fills**. For AUD3435, historical ask first touches the original stop roughly 42 minutes before the actual broker close, and some candles exceed it; for AUD3487 the first touch is about 2 minutes 25 seconds early. Broker transactions remain authoritative. These differences prevent describing the candle model as an exact execution replay or diagnosing a missed broker stop from historical candles alone.

Extending a trade can also prevent a later observed trade. At fixed-exit 2×, definite recent conflicts include **3347→3357**, **3393→3403 (BUY under the historical global cap)**, **3425→3435**, and **3455→3465 (same pair)**. Earlier releases allowed one global position; v4.1+ allows different pairs concurrently. Reentry anchors, cooldowns and the v4.2 loss-reset state would also evolve differently. No replacement entries or hypothetical account-state trajectory are manufactured here.

## Assessment and delivery state

On the retained quote paths, widening the initial stop changes the latest AUD/USD and two other recent losses into profitable exits. It is not a universal explanation: several entries still fail with twice the room, while the exit rules protect other trades from becoming larger losses. The evidence supports separating **entry location, initial stop, BE trigger, target and holding deadline** in the discussion. It does not establish a blanket wider-risk profile as profitable.

No strategy change, increased cash-risk setting, live order, publication or deployment occurred. The previous chart work is preserved separately.

## Reproduction

Run from the repository root:

```sh
python3 docs/reviews/evidence/2026-10-01/sell-exit-study/setup_analysis.py
python3 docs/reviews/evidence/2026-10-01/sell-exit-study/exit_analysis.py
python3 docs/reviews/evidence/2026-10-01/sell-exit-study/setup_structure.py
python3 docs/reviews/evidence/2026-10-01/sell-exit-study/crosscheck.py
python3 docs/reviews/evidence/2026-10-01/sell-exit-study/build_report.py
```

The [capture manifest](evidence/2026-10-01/sell-exit-study/manifest.json) records read-only production revision, acquisition bounds and raw-capture hashes. [Exit results](evidence/2026-10-01/sell-exit-study/exit_results.json) contain all **928** trade/family/width/BE-mode combinations, levels, units, risk, outcome bounds and subgroup sums. An [independent crosscheck](evidence/2026-10-01/sell-exit-study/crosscheck.md) recomputes all sizing/arithmetic, checks 288 aggregates and identifies incompatible later entries. Resized nominal stop risk is 98.7089%–100% of original risk after integer rounding; this is not a guarantee against execution gaps. The scripts use no broker credentials, network calls or runtime imports. Retained market/signal inputs are compressed JSON, and selected trade inputs omit operational credentials and account identifiers.

## Earlier sixteen SELL controls: fixed target and BE

{individual_table([t for t in trades if not t['primary']], 'fixed')}
'''
(BASE.parents[2] / '2026-10-01-sell-entry-and-exit-study.md').write_text(report)
print('Wrote dated SELL entry/exit study')
