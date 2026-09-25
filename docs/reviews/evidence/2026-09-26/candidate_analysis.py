#!/usr/bin/env python3
"""Reproduce the pre-specified Sep21 candidates on the ten new observed fills.

This is a fixed-fill, quote-side sensitivity and observed-episode classification,
not a portfolio backtest. No replacement entries, continuous BE polling, AUD
conversion, alternative slippage, or alternative risk-state evolution is assumed.
M1 timestamps label intervals; extrema do not have individual timestamps.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from zoneinfo import ZoneInfo


def ms(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000


def iso(value):
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()


def normalize(trade):
    payload = trade['broker_reconciliation_payload']
    if isinstance(payload, str):
        payload = json.loads(payload)
    runtime = payload['liveRuntime']
    return {
        'id': trade['oanda_trade_id'], 'instrument': trade['instrument'],
        'side': trade['side'], 'entry_time': trade['entry_time'],
        'exit_time': trade['exit_time'], 'entry_price': trade['entry_price'],
        'exit_price': trade['exit_price'], 'exit_reason': trade['exit_reason'],
        'pnl_aud': trade['pnl_aud'], 'pnl_pips': trade['pnl_pips'],
        'initial_stop_distance': runtime['initialStopDistance'],
        'precision': runtime['instrumentMetadata']['displayPrecision'],
        'signal_context': runtime['entryTelemetry']['strategyContext'],
        'exit_config': runtime['exitConfig'],
    }


def actual_r(trade):
    return (trade['exit_price'] - trade['entry_price']) * (1 if trade['side'] == 'BUY' else -1) / trade['initial_stop_distance']


def deadline(trade):
    config = trade['exit_config']
    entry = datetime.fromtimestamp(trade['entry_time'] / 1000, ZoneInfo(config['sessionCloseTimeZone']))
    session = entry.replace(hour=config['sessionCloseLocalHour'], minute=config['sessionCloseLocalMinute'], second=0, microsecond=0).timestamp() * 1000
    if session < trade['entry_time']:
        session += 86_400_000
    return min(trade['entry_time'] + config['timeStopHours'] * 3_600_000, session)


def post_exit_path(trade, market):
    direction = 1 if trade['side'] == 'BUY' else -1
    side = 'bid' if direction == 1 else 'ask'
    entry, distance = trade['entry_price'], trade['initial_stop_distance']
    cutoff = deadline(trade)
    assert abs(cutoff - ms(market['M1'][trade['id']]['deadline'])) < 1
    levels = {name: round(entry + direction * multiple * distance, trade['precision'])
              for name, multiple in [('initial_stop', -1), ('breakeven', 0), ('target_1_5r', 1.5), ('target_2r', 2)]}
    rows = []
    for candle in market['M1'][trade['id']]['data']['candles']:
        start, end = ms(candle['time']), ms(candle['time']) + 60_000
        if not candle['complete'] or end <= trade['exit_time'] or start >= cutoff:
            continue
        quote = {key: float(value) for key, value in candle[side].items()}
        low_r, high_r = sorted(direction * (quote[key] - entry) / distance for key in ('h', 'l'))
        touches = {name: (quote['h'] >= level if direction == 1 else quote['l'] <= level)
                   for name, level in levels.items() if name.startswith('target')}
        touches.update({name: (quote['l'] <= level if direction == 1 else quote['h'] >= level)
                        for name, level in levels.items() if not name.startswith('target')})
        rows.append({'bar_start_utc': iso(start), 'bar_end_utc': iso(end),
                     'start_ms': start, 'end_ms': end, 'quote_side_ohlc': quote,
                     'low_r': low_r, 'high_r': high_r, 'touches': touches,
                     'straddles_actual_exit': start < trade['exit_time'],
                     'straddles_deadline': end > cutoff})
    wholly_contained = [row for row in rows if not row['straddles_actual_exit'] and not row['straddles_deadline']]
    first_complete = {name: next((row['bar_start_utc'] for row in wholly_contained if row['touches'][name]), None)
                      for name in levels}
    return {'id': trade['id'], 'actual_exit_reason': trade['exit_reason'],
            'actual_exit_utc': iso(trade['exit_time']), 'deadline_utc': iso(cutoff),
            'quote_side': side, 'rounded_levels': levels,
            'path_description': 'Descriptive quote path after actual exit; retaining an already-stopped trade is not simulated. Boundary bars may contain out-of-window extrema.',
            'first_wholly_post_exit_touch_bar_start_utc': first_complete,
            'wholly_post_exit_max_favorable_r': max((row['high_r'] for row in wholly_contained), default=None),
            'wholly_post_exit_min_r': min((row['low_r'] for row in wholly_contained), default=None),
            'path': rows}


def extend_target(trade, path, market, trades, decisions):
    assert trade['exit_reason'] == 'TAKE_PROFIT'
    be_orders = [order for order in market['transactions']
                 if order['type'] == 'STOP_LOSS_ORDER' and order.get('tradeID') == trade['id']
                 and float(order['price']) == trade['entry_price'] and ms(order['time']) < trade['exit_time']]
    # These new winners both have broker-confirmed BE before the original TP.
    assert be_orders, 'Future BE activation needs a separately specified analysis.'
    entry, distance = trade['entry_price'], trade['initial_stop_distance']
    direction = 1 if trade['side'] == 'BUY' else -1
    target = path['rounded_levels']['target_2r']
    target_r = direction * (target - entry) / distance
    partial_target = None
    event = None
    terminal = []
    for row in path['path']:
        if row['straddles_deadline']:
            raise AssertionError('Candidate reaches time boundary without a resolved level: timed exit must be bounded separately.')
        target_touch, be_touch = row['touches']['target_2r'], row['touches']['breakeven']
        if row['straddles_actual_exit']:
            assert not be_touch, 'BE touch in actual-close minute needs separate ordering bounds.'
            if target_touch:
                partial_target = row
            continue
        if target_touch and be_touch:
            event, terminal = {**row, 'kind': 'TARGET_OR_BREAKEVEN_UNORDERED'}, [0, target_r]
            break
        if target_touch or be_touch:
            event = {**row, 'kind': 'TARGET' if target_touch else 'BREAKEVEN'}
            terminal = [target_r if target_touch else 0]
            break
    assert event is not None
    if partial_target is not None and event['kind'] != 'TARGET':
        terminal.append(target_r)
    earliest = max(trade['exit_time'], partial_target['start_ms']) if partial_target else event['start_ms']
    latest = event['end_ms']
    conflicts = [{'id': next_trade['id'], 'entry_utc': iso(next_trade['entry_time']),
                  'status': 'definite' if next_trade['entry_time'] < earliest else 'within_exit_interval'}
                 for next_trade in trades if trade['exit_time'] < next_trade['entry_time'] < latest]
    attempts = [{'decision_record_id': decision['id'], 'instrument': decision['instrument'],
                 'decision_utc': iso(decision['decision_time']), 'side': decision['side'],
                 'outcome': decision['outcome'], 'rejection_code': decision.get('rejection_code')}
                for decision in decisions if trade['exit_time'] < decision['decision_time'] < latest]
    return {'id': trade['id'], 'target_price': target, 'target_r_after_price_rounding': target_r,
            'actual_price_distance_r': actual_r(trade), 'actual_tp_utc': iso(trade['exit_time']),
            'breakeven_confirmed_utc': [order['time'] for order in be_orders],
            'partial_bar_target_touch': partial_target,
            'first_resolved_event': event, 'possible_terminal_r': sorted(set(terminal)),
            'exit_earliest_ms': earliest, 'exit_latest_ms': latest,
            'observed_trade_capacity_conflicts': conflicts, 'observed_decisions_during_extension': attempts}


def reentry(trade, trades, market, previous_override=None):
    previous = previous_override or next((previous for previous in reversed(trades)
                     if previous['instrument'] == trade['instrument'] and previous['exit_time'] < trade['entry_time']), None)
    assert previous is not None
    context = trade['signal_context']
    start, ema = context['signalCandleCloseTime'] - 900_000, context['m15']['fastEma']
    bars = [candle for candle in market['M15'][trade['instrument']]['data']['candles']
            if start - 4 * 900_000 <= ms(candle['time']) < start]
    assert len(bars) == 4 and all(candle['complete'] for candle in bars)
    touch_bars = []
    for candle in bars:
        touches = float(candle['mid']['l']) <= ema if trade['side'] == 'BUY' else float(candle['mid']['h']) >= ema
        if touches:
            touch_bars.append({'start_utc': candle['time'], 'mid_high': candle['mid']['h'], 'mid_low': candle['mid']['l'],
                               'entirely_after_exit': ms(candle['time']) >= previous['exit_time'],
                               'possibly_entirely_after_exit': ms(candle['time']) >= previous.get('exit_earliest_time', previous['exit_time']),
                               'ends_after_exit': ms(candle['time']) + 900_000 > previous['exit_time']})
    same_side = trade['side'] == previous['side']
    applies = same_side and previous['exit_reason'] in ('TAKE_PROFIT', 'BREAKEVEN_STOP')
    fresh = any(candle['entirely_after_exit'] for candle in touch_bars)
    possibly_fresh = any(candle['possibly_entirely_after_exit'] for candle in touch_bars)
    prefix = 'long' if trade['side'] == 'BUY' else 'short'
    breakout = context['m15']['trigger'][prefix + 'Breakout']
    return {'previous_id': previous['id'], 'id': trade['id'], 'instrument': trade['instrument'],
            'previous_exit_reason': previous['exit_reason'], 'previous_exit_utc': iso(previous['exit_time']),
            'previous_exit_is_conditional_upper_bound': 'exit_earliest_time' in previous,
            'previous_exit_earliest_utc': iso(previous.get('exit_earliest_time', previous['exit_time'])),
            'entry_utc': iso(trade['entry_time']), 'signal_bar_start_utc': iso(start),
            'same_side': same_side, 'candidate_applies': applies,
            'actual_exit_reason': trade['exit_reason'], 'actual_pnl_aud': trade['pnl_aud'],
            'actual_price_distance_r': actual_r(trade), 'ema20_at_signal': ema,
            'breakout': breakout, 'pullback': context['m15']['trigger'][prefix + 'Pullback'],
            'touch_bars': touch_bars, 'fresh_completed_post_exit_touch': fresh,
            'all_trigger_candidate_accepts': not applies or fresh,
            'candidate_acceptance_ambiguous': applies and not fresh and possibly_fresh,
            'pullback_only_variant_accepts': not applies or fresh or breakout}


def frozen_tape(trades, targets, all_trades, market, use_2r=True, use_fresh=False):
    rows, busy_earliest, busy_latest = [], 0, 0
    anchors = {}
    for earlier in all_trades:
        if earlier['exit_time'] < trades[0]['entry_time']:
            anchors[earlier['instrument']] = earlier
    for trade in trades:
        if trade['entry_time'] < busy_latest:
            assert trade['entry_time'] < busy_earliest, 'Capacity remains ambiguous.'
            rows.append({'id': trade['id'], 'included': False, 'reason': 'LONGER_EXISTING_POSITION'})
            continue
        gate = reentry(trade, all_trades, market, anchors[trade['instrument']])
        assert not gate['candidate_acceptance_ambiguous'], 'Reentry anchor ordering is ambiguous.'
        if use_fresh and not gate['all_trigger_candidate_accepts']:
            rows.append({'id': trade['id'], 'included': False, 'reason': 'NO_FRESH_POST_EXIT_TOUCH',
                         'gate_anchor_id': gate['previous_id']})
            continue
        alternative = targets.get(trade['id']) if use_2r else None
        if alternative:
            assert len(alternative['possible_terminal_r']) == 1
            value = alternative['possible_terminal_r'][0]
            busy_earliest, busy_latest = alternative['exit_earliest_ms'], alternative['exit_latest_ms']
            anchors[trade['instrument']] = {**trade, 'exit_time': busy_latest,
                                           'exit_earliest_time': busy_earliest,
                                           'exit_reason': 'TAKE_PROFIT' if value > 0 else 'BREAKEVEN_STOP'}
        else:
            value = actual_r(trade)
            busy_earliest = busy_latest = trade['exit_time']
            anchors[trade['instrument']] = trade
        rows.append({'id': trade['id'], 'included': True, 'price_distance_r': value,
                     'gate_anchor_id': gate['previous_id'], 'fresh_gate_applies': gate['candidate_applies'],
                     'fresh_gate_accepts': gate['all_trigger_candidate_accepts']})
    total = sum(row.get('price_distance_r', 0) for row in rows)
    return {'observed_count': len(trades), 'conditional_count': sum(row['included'] for row in rows),
            'observed_price_distance_r': sum(actual_r(trade) for trade in trades),
            'conditional_price_distance_r': total, 'conditional_price_distance_r_bounds': [total, total],
            'rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--production', type=Path, default=Path(__file__).with_name('production-evidence.json'))
    parser.add_argument('--broker', type=Path, default=Path(__file__).with_name('broker-evidence.json'))
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('candidate-results.json'))
    args = parser.parse_args()
    production, market = json.loads(args.production.read_text()), json.loads(args.broker.read_text())
    trades = sorted((normalize(trade) for trade in production['trades']), key=lambda trade: trade['entry_time'])
    new = [trade for trade in trades if production['start_ms'] <= trade['entry_time'] < production['end_ms']]
    assert len(new) == 10 and {trade['id'] for trade in new} == set(market['trades'])
    assert all(a['exit_time'] < b['entry_time'] for a, b in zip(trades, trades[1:]))
    for trade in new:
        pip = .01 if trade['instrument'].endswith('JPY') else .0001
        assert abs(actual_r(trade) - trade['pnl_pips'] * pip / trade['initial_stop_distance']) < 1e-8
        assert trade['exit_config']['intradayTargetRiskMultiple'] == 1.5
        assert trade['exit_config']['maxOpenPositions'] == 1
        assert abs(ms(market['trades'][trade['id']]['closeTime']) - trade['exit_time']) < 1
    paths = {trade['id']: post_exit_path(trade, market) for trade in new}
    targets = {trade['id']: extend_target(trade, paths[trade['id']], market, new, production['decisions'])
               for trade in new if trade['exit_reason'] == 'TAKE_PROFIT'}
    episodes = [reentry(trade, trades, market) for trade in new]
    results = {
        'method': 'Prespecified Sep21 2R sensitivity and all-trigger fresh-post-exit EMA20-touch candidate; new observed fills only; not a portfolio backtest.',
        'review_start_utc': iso(production['start_ms']), 'review_end_utc': iso(production['end_ms']),
        'target_multiple': 2, 'target_extensions': list(targets.values()),
        'frozen_tape_new_cohort': frozen_tape(new, targets, trades, market),
        'four_way_conditional_observed_entry_tape': {
            'baseline': frozen_tape(new, targets, trades, market, use_2r=False, use_fresh=False),
            'target_2r_only': frozen_tape(new, targets, trades, market, use_2r=True, use_fresh=False),
            'fresh_post_exit_only': frozen_tape(new, targets, trades, market, use_2r=False, use_fresh=True),
            'target_2r_and_fresh_post_exit': frozen_tape(new, targets, trades, market, use_2r=True, use_fresh=True),
        },
        'observed_reentry_classifications': episodes,
        'reentry_summary': {
            'applicable_episode_count': sum(episode['candidate_applies'] for episode in episodes),
            'screened_out_observed_ids': [episode['id'] for episode in episodes if not episode['all_trigger_candidate_accepts']],
            'applicable_retained_observed_ids': [episode['id'] for episode in episodes if episode['candidate_applies'] and episode['all_trigger_candidate_accepts']],
            'pullback_only_variant_screened_out_ids': [episode['id'] for episode in episodes if not episode['pullback_only_variant_accepts']],
        },
        'post_exit_paths_through_original_deadline': list(paths.values()),
        'limitations': [
            'Historical predecessor classifications are not a stateful strategy replay; rejecting an entry can change later anchors, capacity and risk state.',
            'Four-way conditional tape updates exit anchors after included observed fills and skips excluded fills, but still cannot restore unobserved entries or recalculate live cooldown/risk decisions.',
            'Only actual TP exits are extended for the prespecified 2R target test; all other observed exit rules/outcomes stay fixed.',
            'Executable bid for buys and ask for sells include spread; historical half-spread costs must not be subtracted a second time.',
            'Conditional rounded-level fills omit alternative slippage, AUD conversion, changing sizes and replacement opportunities.',
            'OHLC timestamps identify bar starts, never the exact time or order of high/low touches; boundary-minute extrema may lie outside the observation interval.',
            'Post-stop price recovery is descriptive and does not establish that loosening or removing stops would improve performance.',
            'Ten entries and three qualifying reentry episodes are insufficient to establish a profitable new policy.'
        ]}
    args.output.write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps({key: results[key] for key in ('frozen_tape_new_cohort', 'reentry_summary')}, indent=2))


if __name__ == '__main__':
    main()
