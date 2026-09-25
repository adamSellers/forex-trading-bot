#!/usr/bin/env python3
"""Evaluate one prespecified structural pullback candidate; no service calls.

Reverse the ordinary EMA recurrence from the saved signal-bar EMA and known
completed closes. This recovers the exact same finite-history EMA sequence used
by the live decision, without reseeding an EMA from later historical downloads.
The opportunity input is a reduced, account-free copy of the raw scan capture.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
EVIDENCE = BASE.parent
OLD = EVIDENCE.parent / '2026-09-21' / 'evaluation'
MINUTE = 60_000


def parse(value):
    return json.loads(value) if isinstance(value, str) else value


def ms(value):
    return round(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def iso(value):
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def extract(raw_path):
    raw = json.loads(raw_path.read_text())
    attempts = defaultdict(list)
    for decision in raw['decisions']:
        attempts[(decision['instrument'], decision['signal_candle_time'])].append(decision)
    observations = {}
    duplicate_context_differences = []
    for signal in raw['signals']:
        ctx = parse(signal['decision_context']).get('strategyContext', {})
        m15 = ctx.get('m15', {})
        if 'trigger' not in m15:
            continue
        key = (signal['instrument'], signal['signal_candle_time'])
        h1 = ctx['h1']
        direction = 1 if h1['longRegime'] else -1 if h1['shortRegime'] else 0
        assert direction != 0
        reduced = {name: m15[name] for name in ('close', 'fastEma', 'slowEma', 'trigger')}
        row = {'instrument': key[0], 'signal_bar_start_ms': key[1],
               'signal_bar_start_utc': iso(key[1]), 'direction': direction,
               'saved_m15': reduced,
               'scan_reason_code': signal['reason_code'],
               'attempt_count': len(attempts[key]),
               'attempt_outcomes': dict(Counter(x['outcome'] for x in attempts[key])),
               'attempt_rejection_codes': dict(Counter(x['rejection_code'] for x in attempts[key] if x['rejection_code']))}
        if key in observations:
            if observations[key]['saved_m15'] != reduced:
                duplicate_context_differences.append({'instrument': key[0], 'signal_bar_start_ms': key[1]})
            continue
        observations[key] = row
    write(BASE / 'pullback-opportunities.json', {
        'raw_capture_sha256': hashlib.sha256(raw_path.read_bytes()).hexdigest(),
        'description': 'Distinct completed-candle observations that reached the trigger evaluation, copied from the full September 26 raw capture. First observation per pair/candle. No credentials, account identifiers or settings.',
        'total_scan_records': len(raw['signals']),
        'distinct_attempted_setups': len({x['setup_id'] for x in raw['decisions']}),
        'duplicate_saved_m15_differences': duplicate_context_differences,
        'observations': sorted(observations.values(), key=lambda x: (x['signal_bar_start_ms'], x['instrument']))})


def get_market():
    markets = defaultdict(dict)
    old_market = json.loads((OLD / 'market-data.json').read_text())
    new_market = json.loads((EVIDENCE / 'broker-evidence.json').read_text())
    for source in (old_market['M15'], new_market['M15']):
        for instrument, data in source.items():
            for bar in data.get('data', data)['candles']:
                if not bar['complete']:
                    continue
                stamp = ms(bar['time'])
                row = {'time': stamp, **{k: float(v) for k, v in bar['mid'].items()}}
                if stamp in markets[instrument]:
                    assert markets[instrument][stamp] == row
                markets[instrument][stamp] = row
    return {key: sorted(value.values(), key=lambda b: b['time']) for key, value in markets.items()}


def evaluate(instrument, start, direction, m15, market):
    bars = market.get(instrument, [])
    indices = [i for i, b in enumerate(bars) if b['time'] == start]
    if not indices:
        return {'available': False, 'reason': 'No retained midpoint M15 history for this pair/candle'}
    index = indices[0]
    if index < 8:
        return {'available': False, 'reason': 'Fewer than eight prior retained bars'}
    current = bars[index]
    assert abs(current['c'] - m15['close']) < 1e-10, (instrument, iso(start), current['c'], m15['close'])
    window = [dict(b) for b in bars[index - 4:index]]
    for period, field in [(20, 'fastEma'), (50, 'slowEma')]:
        alpha = 2 / (period + 1)
        ema = m15[field]
        for position in range(index - 1, index - 5, -1):
            ema = (ema - alpha * bars[position + 1]['c']) / (1 - alpha)
            window[position - (index - 4)][field] = ema
    bullish = current['c'] > current['o']
    bearish = current['c'] < current['o']
    directional = bullish if direction > 0 else bearish
    old_touches = [i for i, bar in enumerate(window)
                   if (bar['l'] <= m15['fastEma'] if direction > 0 else bar['h'] >= m15['fastEma'])]
    new_touches = [i for i, bar in enumerate(window)
                   if (bar['l'] <= bar['fastEma'] if direction > 0 else bar['h'] >= bar['fastEma'])]
    old_structure = all(bar['c'] > m15['slowEma'] if direction > 0 else bar['c'] < m15['slowEma'] for bar in window)
    new_structure = all(bar['c'] > bar['slowEma'] if direction > 0 else bar['c'] < bar['slowEma'] for bar in window)
    old_boundary = max(b['h'] for b in window[-2:]) if direction > 0 else min(b['l'] for b in window[-2:])
    old_resumption = current['c'] > old_boundary if direction > 0 else current['c'] < old_boundary
    latest_touch = new_touches[-1] if new_touches else None
    resumption_start = min(latest_touch, 2) if latest_touch is not None else 2
    new_boundary = max(b['h'] for b in window[resumption_start:]) if direction > 0 else min(b['l'] for b in window[resumption_start:])
    new_resumption = current['c'] > new_boundary if direction > 0 else current['c'] < new_boundary
    original_pullback = directional and bool(old_touches) and old_structure and old_resumption
    candidate_pullback = directional and bool(new_touches) and new_structure and new_resumption
    breakout_window = bars[index - 8:index]
    breakout = directional and (current['c'] > max(b['h'] for b in breakout_window) if direction > 0 else current['c'] < min(b['l'] for b in breakout_window))
    prefix = 'long' if direction > 0 else 'short'
    assert original_pullback == m15['trigger'][prefix + 'Pullback'], (instrument, iso(start), 'pullback reproduction')
    assert breakout == m15['trigger'][prefix + 'Breakout'], (instrument, iso(start), 'breakout reproduction')
    return {
        'available': True, 'legacy_trigger_reproduced': True,
        'original_pullback': original_pullback, 'candidate_pullback': candidate_pullback,
        'breakout': breakout, 'original_trigger_qualifies': original_pullback or breakout,
        'candidate_trigger_qualifies': candidate_pullback or breakout,
        'old_touch_times': [iso(window[i]['time']) for i in old_touches],
        'candidate_touch_times': [iso(window[i]['time']) for i in new_touches],
        'latest_candidate_touch_utc': iso(window[latest_touch]['time']) if latest_touch is not None else None,
        'old_structure': old_structure, 'candidate_structure': new_structure,
        'old_resumption_boundary': old_boundary, 'candidate_resumption_boundary': new_boundary,
        'old_resumption': old_resumption, 'candidate_resumption': new_resumption,
        'signal_close': current['c'],
        'prior_bars': [{**bar, 'start_utc': iso(bar['time'])} for bar in window],
    }


def group(rows, key):
    groups = defaultdict(list)
    for row in rows:
        groups[str(row[key])].append(row)
    return {label: summary(values) for label, values in groups.items()}


def summary(rows):
    available = [x for x in rows if x['evaluation']['available']]
    return {'count': len(rows), 'available': len(available),
            'original_trigger_count': sum(x['evaluation']['original_trigger_qualifies'] for x in available),
            'candidate_trigger_count': sum(x['evaluation']['candidate_trigger_qualifies'] for x in available),
            'removed_trigger_count': sum(x['evaluation']['original_trigger_qualifies'] and not x['evaluation']['candidate_trigger_qualifies'] for x in available),
            'new_trigger_count': sum(not x['evaluation']['original_trigger_qualifies'] and x['evaluation']['candidate_trigger_qualifies'] for x in available),
            'pullback_membership_changed': sum(x['evaluation']['original_pullback'] != x['evaluation']['candidate_pullback'] for x in available),
            'removed_actual_trade_ids': [x['id'] for x in available if 'id' in x and not x['evaluation']['candidate_trigger_qualifies']],
            'removed_actual_pnl_aud_descriptive_only': round(sum(x.get('pnl_aud', 0) for x in available if x['evaluation']['original_trigger_qualifies'] and not x['evaluation']['candidate_trigger_qualifies']), 4)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extract-raw', type=Path)
    args = parser.parse_args()
    if args.extract_raw:
        extract(args.extract_raw)
    frozen = json.loads((BASE / 'pullback-prespecified-candidate.json').read_text())
    assert frozen['candidate_id'] == 'bar-aligned-pullback-resumption-v1'
    market = get_market()
    source = json.loads((EVIDENCE / 'production-evidence.json').read_text())
    old_source = json.loads((OLD / 'inputs.json').read_text())
    old_release = {t['id']: t['release'] for t in old_source['trades']}
    rows = []
    previous = {}
    for trade in sorted(source['trades'], key=lambda t: t['entry_time']):
        payload = parse(trade['broker_reconciliation_payload'])['liveRuntime']
        ctx = payload['entryTelemetry']['strategyContext']
        start = ctx['signalCandleCloseTime'] - 15 * MINUTE
        direction = 1 if trade['side'] == 'BUY' else -1
        result = evaluate(trade['instrument'], start, direction, ctx['m15'], market)
        prior = previous.get(trade['instrument'])
        row = {'id': str(trade['oanda_trade_id']), 'instrument': trade['instrument'], 'side': trade['side'],
               'entry_utc': iso(trade['entry_time']), 'signal_bar_start_utc': iso(start),
               'release': old_release.get(str(trade['oanda_trade_id']), 'm15-intraday-v3.3'),
               'cohort': 'latest_10' if source['start_ms'] <= trade['entry_time'] else 'previous_15' if old_source['review_start_ms'] <= trade['entry_time'] else 'earlier_10',
               'pnl_aud': trade['pnl_aud'], 'exit_reason': trade['exit_reason'],
               'original_trigger_type': 'both' if result.get('breakout') and result.get('original_pullback') else 'pullback_only' if result.get('original_pullback') else 'breakout_only',
               'previous_observed_pair_trade_id': None if prior is None else str(prior['oanda_trade_id']),
               'repeat_after_protected_exit': prior is not None and prior['side'] == trade['side'] and prior['exit_reason'] in ('TAKE_PROFIT', 'BREAKEVEN_STOP'),
               'evaluation': result}
        rows.append(row)
        previous[trade['instrument']] = trade
    opportunities = json.loads((BASE / 'pullback-opportunities.json').read_text())
    observation_rows = []
    for row in opportunities['observations']:
        result = evaluate(row['instrument'], row['signal_bar_start_ms'], row['direction'], row['saved_m15'], market)
        observation_rows.append({**{k: v for k, v in row.items() if k != 'saved_m15'}, 'evaluation': result})
    result = {
        'candidate_id': frozen['candidate_id'],
        'method': 'Exact saved-EMA recurrence inversion over previous four bars; original trigger booleans asserted against saved live context. Retained market candles supply original completed OHLC. No reseeded EMA, replacement fills, sizing, execution, risk-state or portfolio replay.',
        'trade_summary': summary(rows), 'by_cohort': group(rows, 'cohort'),
        'by_original_trigger': group(rows, 'original_trigger_type'),
        'by_protected_exit_repeat': group(rows, 'repeat_after_protected_exit'),
        'opportunity_summary': summary(observation_rows),
        'attempted_opportunity_summary': summary([x for x in observation_rows if x['attempt_count']]),
        'opportunity_context_changes_within_same_candle': len(opportunities['duplicate_saved_m15_differences']),
        'limitations': [
            'The candidate was frozen before this outcome comparison, but the broad weak-pullback pattern and reviewed outcomes were already known; this is not untouched out-of-sample validation.',
            'The 35 actual fills span mixed releases. Original trade outcomes describe what the candidate changes; excluded P&L is not expected benefit.',
            'The latest raw capture supplies trigger-stage observations and attempted setups; earlier retained scan inputs preserve regime only, so earlier full opportunity reconstruction is unavailable.',
            'Retained M15 candles cover AUD/USD, EUR/USD and USD/JPY. GBP/USD observations are explicitly unavailable.',
            'A new trigger in a former no-trigger observation is not an executable opportunity: downstream cost, position, spread, risk, cooldown and pricing checks are not replayed.',
            'This is a pullback-trigger comparison only. It does not apply the separate post-exit freshness/fade branch or evolve alternative closed-trade anchors.'
        ],
        'trades': rows, 'opportunities': observation_rows,
    }
    write(BASE / 'pullback-results.json', result)
    print(json.dumps({key: value for key, value in result.items() if key not in ('trades', 'opportunities')}, indent=2))


if __name__ == '__main__':
    main()
