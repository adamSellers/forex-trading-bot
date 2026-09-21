#!/usr/bin/env python3
"""Reproduce conditional target sensitivity and observed re-entry screens.

This is deliberately not a runtime simulator. It keeps observed fills fixed,
uses broker-side OHLC to bound post-TP paths, and identifies capacity conflicts.
It never invents replacement fills, continuous breakeven polling, or AUD returns.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--inputs', type=Path, default=HERE / 'inputs.json')
parser.add_argument('--market-data', type=Path, default=HERE / 'market-data.json')
parser.add_argument('--output', type=Path, default=HERE / 'results.json')
args = parser.parse_args()
data = json.loads(args.inputs.read_text())
market = json.loads(args.market_data.read_text())
trades = sorted(data['trades'], key=lambda t: t['entry_time'])
by_id = {t['id']: t for t in trades}
ms = lambda value: datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
iso = lambda value: datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()
in_window = lambda t: data['review_start_ms'] <= t['entry_time'] < data['review_end_ms']
actual_r = lambda t: (t['exit_price'] - t['entry_price']) * (1 if t['side'] == 'BUY' else -1) / t['initial_stop_distance']

# Baseline consistency checks catch unintended look-ahead, overlaps and price-side errors.
assert len(trades) == 25 and sum(map(in_window, trades)) == 15
assert all(a['exit_time'] < b['entry_time'] for a, b in zip(trades, trades[1:]))
for t in trades:
    pip = .01 if t['instrument'].endswith('JPY') else .0001
    assert abs(actual_r(t) - t['pnl_pips'] * pip / t['initial_stop_distance']) < 1e-8


def deadline(trade):
    entry = datetime.fromtimestamp(trade['entry_time'] / 1000, ZoneInfo('America/New_York'))
    session = entry.replace(hour=16, minute=45, second=0, microsecond=0).timestamp() * 1000
    if session < trade['entry_time']:
        session += 86_400_000
    return min(trade['entry_time'] + trade['time_stop_hours'] * 3_600_000, session)


def extend_target(trade):
    """Bound first 2R/BE event after actual TP, not a new trade execution."""
    direction = 1 if trade['side'] == 'BUY' else -1
    quote_side = 'bid' if direction > 0 else 'ask'
    entry, distance = trade['entry_price'], trade['initial_stop_distance']
    precision = 3 if trade['instrument'].endswith('JPY') else 5
    target = round(entry + direction * 2 * distance, precision)
    target_r = direction * (target - entry) / distance
    be_orders = [order for order in trade['stop_orders']
                 if float(order['price']) == entry and ms(order['time']) < trade['exit_time']]
    observations = market['M1'][trade['id']]['data']['candles']
    cutoff = deadline(trade)
    partial_target = None
    outcomes = []
    first_event = None
    minimum_r = float('inf')
    for candle in observations:
        start = ms(candle['time'])
        end = start + 60_000
        if not candle['complete'] or end <= trade['exit_time'] or start >= cutoff:
            continue
        q = {k: float(v) for k, v in candle[quote_side].items()}
        low_r, high_r = sorted(direction * (q[k] - entry) / distance for k in ('h', 'l'))
        minimum_r = min(minimum_r, low_r)
        touches_target = q['h'] >= target if direction > 0 else q['l'] <= target
        # Checking BE even when not yet activated gives a conservative envelope.
        # The only such retained trade (3097) stays above BE through 2R, so both
        # retained initial-stop and immediately-active-BE cases agree.
        touches_be = low_r <= 0
        partial = start < trade['exit_time']
        event = {'bar_start_utc': iso(start), 'bar_end_utc': iso(end),
                 'earliest_ms': max(start, trade['exit_time']), 'latest_ms': min(end, cutoff),
                 'partial_start_bar': partial, 'low_r': low_r, 'high_r': high_r}
        if end > cutoff:
            raise ValueError('Deadline boundary requires explicit ordering bounds')
        if partial and touches_be:
            raise ValueError('Partial starting bar touches breakeven; stop timing relative to actual exit is unresolved')
        if partial and touches_target:
            partial_target = event
            # Even the minute's last quote has no retained tick timestamp.
            # Treat the entire boundary candle as uncertain; a later complete
            # candle must establish the continuation independently.
            continue
        if touches_target and touches_be:
            outcomes.extend([0, target_r])
            first_event = {**event, 'kind': 'TARGET_OR_BREAKEVEN_UNORDERED'}
            break
        if touches_target:
            outcomes.append(target_r)
            first_event = {**event, 'kind': 'TARGET'}
            break
        if touches_be:
            if not be_orders:
                raise ValueError('Unknown future BE activation requires separate stop bounds')
            outcomes.append(0)
            first_event = {**event, 'kind': 'BREAKEVEN'}
            break
    assert first_event is not None, 'No touch: need a separately specified timed-close quote'
    if partial_target and first_event['kind'] != 'TARGET':
        outcomes.append(target_r)
    outcomes = sorted(set(outcomes))
    earliest = partial_target['earliest_ms'] if partial_target else first_event['earliest_ms']
    latest = first_event['latest_ms']
    attempts = [decision for decision in data['decisions']
                if trade['exit_time'] < decision['decision_time'] < latest]
    conflicts = [{'id': next_trade['id'], 'entry_utc': iso(next_trade['entry_time']),
                  'status': 'definite' if next_trade['entry_time'] < earliest else 'within_event_interval',
                  'actual_pnl_aud': next_trade['pnl_aud']}
                 for next_trade in trades if trade['exit_time'] < next_trade['entry_time'] < latest]
    return {'id': trade['id'], 'review_window': in_window(trade), 'side': trade['side'],
            'quote_side': quote_side, 'target_price': target, 'target_r_after_price_rounding': target_r,
            'actual_tp_utc': iso(trade['exit_time']), 'deadline_utc': iso(cutoff),
            'breakeven_confirmed_before_tp': bool(be_orders),
            'minimum_r_in_included_bars': minimum_r,
            'partial_bar_target_touch': partial_target, 'first_resolved_event': first_event,
            'possible_terminal_r': outcomes,
            'exit_earliest_ms': earliest, 'exit_latest_ms': latest,
            'observed_trade_capacity_conflicts': conflicts,
            'observed_decisions_during_extension': attempts}


targets = {t['id']: extend_target(t) for t in trades if t['exit_reason'] == 'TAKE_PROFIT'}


def frozen_tape(cohort):
    """Remove definitely overlapping observed entries; no replacement fills."""
    rows = []
    busy_earliest = busy_latest = 0
    for trade in cohort:
        if trade['entry_time'] < busy_latest:
            assert trade['entry_time'] < busy_earliest, 'Capacity outcome remains ambiguous'
            rows.append({'id': trade['id'], 'included': False, 'reason': 'LONGER_EXISTING_POSITION'})
            continue
        alternative = targets.get(trade['id'])
        if alternative:
            assert len(alternative['possible_terminal_r']) == 1, 'Retained target outcome is unresolved'
            value = alternative['possible_terminal_r'][0]
            busy_earliest, busy_latest = alternative['exit_earliest_ms'], alternative['exit_latest_ms']
        else:
            value = actual_r(trade)
            busy_earliest = busy_latest = trade['exit_time']
        rows.append({'id': trade['id'], 'included': True, 'conditional_price_r': value,
                     'exit_earliest_ms': busy_earliest, 'exit_latest_ms': busy_latest})
    return {'baseline_entries': len(cohort), 'conditional_retained_entries': sum(r['included'] for r in rows),
            'baseline_price_r': sum(actual_r(t) for t in cohort),
            'conditional_price_r': sum(r.get('conditional_price_r', 0) for r in rows), 'rows': rows}


episodes = []
for previous in trades:
    if previous['exit_reason'] not in ('TAKE_PROFIT', 'BREAKEVEN_STOP'):
        continue
    trade = next((t for t in trades if t['entry_time'] > previous['exit_time']
                  and t['instrument'] == previous['instrument']), None)
    if not trade:
        continue
    context = trade['signal_context']
    start = context['signalCandleCloseTime'] - 900_000
    ema = context['m15']['fastEma']
    prefix = 'long' if trade['side'] == 'BUY' else 'short'
    trigger = context['m15']['trigger']
    bars = [c for c in market['M15'][trade['instrument']]['candles']
            if start - 4 * 900_000 <= ms(c['time']) < start]
    assert len(bars) == 4 and all(c['complete'] for c in bars)
    touch_bars = []
    for candle in bars:
        touches = float(candle['mid']['l']) <= ema if trade['side'] == 'BUY' else float(candle['mid']['h']) >= ema
        if touches:
            touch_bars.append({'time': candle['time'], 'mid_high': candle['mid']['h'], 'mid_low': candle['mid']['l'],
                               'entirely_after_exit': ms(candle['time']) >= previous['exit_time'],
                               'ends_after_exit': ms(candle['time']) + 900_000 > previous['exit_time']})
    fresh = any(c['entirely_after_exit'] for c in touch_bars)
    reset_observations = [o for o in data['regime_observations']
                          if o['instrument'] == trade['instrument']
                          and previous['exit_time'] <= o['timestamp'] < trade['entry_time']
                          and o['regime'] != (1 if trade['side'] == 'BUY' else -1)]
    reset = bool(reset_observations) if previous['exit_time'] >= data['review_start_ms'] else None
    episodes.append({'previous_id': previous['id'], 'id': trade['id'], 'pair': trade['instrument'],
                     'review_window': in_window(trade), 'release': trade['release'],
                     'previous_exit_reason': previous['exit_reason'], 'previous_exit_utc': iso(previous['exit_time']),
                     'entry_utc': iso(trade['entry_time']), 'gap_minutes': (trade['entry_time']-previous['exit_time'])/60_000,
                     'same_side': previous['side'] == trade['side'], 'actual_pnl_aud': trade['pnl_aud'],
                     'outcome': trade['exit_reason'], 'breakout': trigger[prefix+'Breakout'],
                     'pullback': trigger[prefix+'Pullback'], 'ema20_at_signal': ema,
                     'touch_bars': touch_bars, 'fresh_completed_post_exit_touch': fresh,
                     'fresh_rule_gating_all_triggers_accepts': fresh,
                     'fresh_rule_gating_pullback_only_accepts': fresh or trigger[prefix+'Breakout'],
                     'signal_candle_starts_after_exit': start >= previous['exit_time'],
                     'h1_reset_observed': reset,
                     'first_h1_reset_utc': iso(reset_observations[0]['timestamp']) if reset_observations else None})

results = {'method': 'Conditional observed-entry sensitivity; not an execution replay or projected AUD return.',
           'target_multiple': 2, 'target_extensions': list(targets.values()),
           'frozen_tape_review_window': frozen_tape([t for t in trades if in_window(t)]),
           'frozen_tape_earlier_context': frozen_tape([t for t in trades if not in_window(t)]),
           'reentry_episodes': episodes}
args.output.write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps({key: {k: v for k, v in results[key].items() if k != 'rows'}
                  for key in ('frozen_tape_review_window', 'frozen_tape_earlier_context')}, indent=2))
print('Fresh-post-exit screen removes observed episodes:', ', '.join(e['id'] for e in episodes
      if not e['fresh_rule_gating_all_triggers_accepts']))
print('Pullback-only screen removes observed episodes:', ', '.join(e['id'] for e in episodes
      if not e['fresh_rule_gating_pullback_only_accepts']))
