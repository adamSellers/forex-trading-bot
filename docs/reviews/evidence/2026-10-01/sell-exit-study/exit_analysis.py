#!/usr/bin/env python3
"""Fixed-fill historical ask-quote sensitivity; NOT an execution/portfolio backtest.

Inputs are sanitized API records, OANDA closed trades/order transactions, S5 BA
candles, and saved signals. No credentials, network, order submission or runtime
imports. See the review for the distinction between broker fills and candle data.
"""
import collections
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import gzip
import json
import math
from pathlib import Path

BASE = Path(__file__).resolve().parent
MULTIPLIERS = (1, 1.25, 1.5, 2)
MODES = ('poll_0', 'poll_5', 'touch', 'no_be')


def ms(s):
    return round(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)


def rounded(n, precision):
    return float(Decimal(str(n)).quantize(Decimal(10) ** -precision, rounding=ROUND_HALF_UP))


def initial_orders(t, market):
    orders = [x for x in market['transactions'] if x.get('tradeID') == t['id']
              and t['entryTime'] - 1 <= ms(x['time']) <= t['entryTime'] + 5000]
    stop = [x for x in orders if x['type'] == 'STOP_LOSS_ORDER'][-1]
    target = [x for x in orders if x['type'] == 'TAKE_PROFIT_ORDER'][-1]
    return float(stop['price']), float(target['price'])


def candles(t, market):
    return [dict(start=ms(c['time']), end=ms(c['time']) + 5000,
                 **{k: float(v) for k, v in c['ask'].items()})
            for c in market['candles'][t['id']] if c['complete']]


def simulate(t, bars, stop, target, trigger, mode, multiplier, initial_ask):
    entry, deadline = t['entryPrice'], t['deadline']
    # The retained signal tape contains no opposite exit in these windows.
    # H1-neutral is deliberately not introduced as a new exit.
    states = {False}
    outcomes, flags = [], set()
    poll = math.ceil(t['entryTime'] / 10000) * 10000
    if mode == 'poll_5':
        poll = math.ceil((t['entryTime'] - 5000) / 10000) * 10000 + 5000
    last_close = initial_ask

    def terminal(kind, price, bar):
        outcomes.append({'kind': kind, 'price': price,
                         'earliest': max(t['entryTime'], bar['start']),
                         'latest': min(deadline, bar['end'])})

    def run_polls(until):
        nonlocal states, poll
        if not mode.startswith('poll_'):
            return
        while poll <= until:
            # No new event is not a quote failure: carry the last candle close.
            if last_close is not None and last_close <= trigger + 1e-12:
                states = {True} if states else set()
            poll += 10000

    for bar in bars:
        if bar['end'] <= t['entryTime']:
            continue
        run_polls(min(bar['start'], deadline))
        if not states:
            break
        if bar['start'] >= deadline:
            # Deadline lies in a quiet interval: latest observed ask is carried.
            assert last_close is not None
            terminal(t['deadlineReason'], last_close, {'start': deadline, 'end': deadline})
            states = set()
            break
        if bar['end'] > deadline:
            # Extremum timestamps unknown: give both prices of the containing
            # five-second interval, never use a later target as an on-time win.
            for active in states:
                upper = entry if active else stop
                terminal(t['deadlineReason'], max(target, min(upper, bar['l'])), bar)
                terminal(t['deadlineReason'], max(target, min(upper, bar['h'])), bar)
                if bar['h'] >= upper:
                    flags.add('deadline_bar_stop_touch_unordered')
                    terminal('BREAKEVEN_STOP' if active else 'STOP_LOSS', upper, bar)
                if bar['l'] <= target:
                    flags.add('deadline_bar_target_touch_unordered')
                    terminal('TAKE_PROFIT', target, bar)
            flags.add('deadline_price_bounded_by_S5_high_low')
            states = set()
            break
        partial = bar['start'] < t['entryTime']
        paths = [[bar['o'], bar['h'], bar['l'], bar['c']],
                 [bar['o'], bar['l'], bar['h'], bar['c']]]
        if partial:
            # Either extreme can predate entry; also test only the ending quote.
            paths.append([bar['c']])
        next_states = set()
        for active in states:
            for path in paths:
                be, ended = active, False
                for index, price in enumerate(path):
                    upper = entry if be else stop
                    if price >= upper - 1e-12:
                        # At candle open a stop may gap; OHLC crossings are at
                        # the level. Unknown intra-bucket slippage is excluded.
                        fill = max(upper, price) if index == 0 else upper
                        terminal('BREAKEVEN_STOP' if be else 'STOP_LOSS', fill, bar)
                        ended = True
                        break
                    if price <= target + 1e-12:
                        terminal('TAKE_PROFIT', target, bar)
                        ended = True
                        break
                    if mode == 'touch' and price <= trigger + 1e-12:
                        be = True
                if ended and partial:
                    flags.add('entry_bar_touch_unordered')
                if not ended:
                    next_states.add(be)
        states = next_states
        last_close = bar['c']
        if bar['end'] < deadline:
            run_polls(bar['end'])
        elif states:
            terminal(t['deadlineReason'], last_close, {'start': deadline, 'end': deadline})
            states = set()
            break
    if states:
        assert bars[-1]['end'] >= deadline, (t['id'], 'missing deadline coverage')
    unique = {(o['kind'], round(o['price'], 8), o['earliest'], o['latest']): o for o in outcomes}
    outcomes = list(unique.values())
    assert outcomes, (t['id'], mode)
    return outcomes, sorted(flags)


def result(t, market, family, multiplier, mode):
    original_stop, original_target = initial_orders(t, market)
    entry = t['entryPrice']
    d = float(Decimal(str(original_stop)) - Decimal(str(entry)))
    stop = rounded(Decimal(str(entry)) + Decimal(str(d)) * Decimal(str(multiplier)), t['precision'])
    distance = float(Decimal(str(stop)) - Decimal(str(entry)))
    target = original_target if family == 'fixed' or multiplier == 1 else rounded(
        Decimal(str(entry)) - Decimal(str(distance)) * Decimal('1.5'), t['precision'])
    be_distance = t['initialDistance'] if family == 'fixed' or multiplier == 1 else distance
    units = math.floor(t['units'] * d / distance + 1e-8)
    risk = t['units'] * d * t['lossConversion']
    opening_fill = next(x for x in market['transactions'] if x['id'] == t['id'])
    initial_ask = float(opening_fill['fullPrice']['asks'][0]['price'])
    outcomes, flags = simulate(t, candles(t, market), stop, target, entry - be_distance, mode, multiplier, initial_ask)
    for o in outcomes:
        move = entry - o['price']
        rate = t['gainConversion'] if move > 0 else t['lossConversion']
        o.update(pips=move / t['pipSize'], original_price_r=move / d,
                 resized_risk_r=move * units / (d * t['units']),
                 cash_proxy_aud=move * units * rate,
                 unchanged_units_cash_proxy_aud=move * t['units'] * rate)
    return dict(id=t['id'], family=family, multiplier=multiplier, mode=mode,
                stop=stop, target=target, be_trigger=entry - be_distance,
                original_stop=original_stop, original_target=original_target,
                original_risk_aud=risk, units=units, original_units=t['units'],
                resized_risk_aud=units * distance * t['lossConversion'],
                outcomes=outcomes, flags=flags)


def aggregate(rows):
    # Bounds sum independent trade outcomes; they are NOT portfolio P&L.
    keys = ['cash_proxy_aud', 'unchanged_units_cash_proxy_aud', 'resized_risk_r']
    return {'count': len(rows), **{key: {
        'low': sum(min(o[key] for o in r['outcomes']) for r in rows),
        'high': sum(max(o[key] for o in r['outcomes']) for r in rows)} for key in keys},
        'positive_all_paths': sum(min(o['cash_proxy_aud'] for o in r['outcomes']) > 1e-9 for r in rows),
        'negative_all_paths': sum(max(o['cash_proxy_aud'] for o in r['outcomes']) < -1e-9 for r in rows),
        'zero_all_paths': sum(all(abs(o['cash_proxy_aud']) < 1e-9 for o in r['outcomes']) for r in rows)}


def analyze(inputs, market, signals):
    validations, baseline = [], []
    for t in inputs:
        bt = market['trades'][t['id']]
        net = float(bt['realizedPL']) + float(bt['financing'])
        assert abs(net - t['pnlAud']) < 1e-8, t['id']
        assert abs(float(bt['price']) - t['entryPrice']) < 1e-8
        assert abs(float(bt['averageClosePrice']) - t['exitPrice']) < 1e-8
        assert abs(float(bt['initialUnits'])) == t['units']
        bars = candles(t, market)
        # Quiet S5 buckets can be absent. The broker entry ask carries until
        # the first available candle; no arbitrary quote-age gate is added.
        assert bars[-1]['end'] >= t['deadline']
        stop, target = initial_orders(t, market)
        stop_touch = next((b for b in bars if b['h'] >= stop and b['end'] > t['entryTime']), None)
        reversals = [s for s in signals[t['id']] if s['signal'] in ('BUY', 'EXIT_SHORT_ONLY', 'EXIT_ONLY')]
        assert not reversals, (t['id'], reversals)
        validations.append(dict(id=t['id'], broker_net_aud=net, candles=len(bars),
            original_stop=stop, original_target=target,
            first_candle_start_minus_entry_seconds=(bars[0]['start'] - t['entryTime']) / 1000,
            first_initial_stop_touch_start=stop_touch['start'] if stop_touch else None,
            initial_stop_touch_seconds_before_actual_exit=(t['exitTime'] - stop_touch['start']) / 1000 if stop_touch else None,
            signal_counts=dict(collections.Counter(s['signal'] for s in signals[t['id']])),
            retained_reversal_signals=len(reversals)))
        r = result(t, market, 'fixed', 1, 'poll_0')
        baseline.append(dict(id=t['id'], actual_exit=t['exitReason'], actual_pnl_aud=t['pnlAud'],
                             model_kinds=sorted({o['kind'] for o in r['outcomes']}),
                             model_cash_low=min(o['cash_proxy_aud'] for o in r['outcomes']),
                             model_cash_high=max(o['cash_proxy_aud'] for o in r['outcomes']),
                             class_match=any(o['kind'] == t['exitReason'] for o in r['outcomes'])))
    rows = [result(t, market, family, m, mode) for t in inputs
            for family in ('fixed', 'scaled') for m in MULTIPLIERS for mode in MODES]
    grouped = []
    for cohort in ('recent', 'earlier', 'all'):
        for subset in ('all_trades', 'actual_negative', 'actual_nonnegative'):
            ids = {t['id'] for t in inputs if (cohort == 'all' or t['primary'] == (cohort == 'recent'))
                   and (subset == 'all_trades' or (t['pnlAud'] < 0) == (subset == 'actual_negative'))}
            for family in ('fixed', 'scaled'):
                for m in MULTIPLIERS:
                    for mode in MODES:
                        selected = [r for r in rows if r['id'] in ids and r['family'] == family and r['multiplier'] == m and r['mode'] == mode]
                        grouped.append(dict(cohort=cohort, subset=subset, family=family, multiplier=m, mode=mode, **aggregate(selected)))
    return dict(method='historical_S5_ask_fixed_fill_sensitivity_v1',
        cash_definition='Entry-time gain/loss conversion, floored smaller units preserving original broker-stop cash risk; excludes hypothetical execution costs/conversion changes.',
        modes={'poll_0': '10-second checks at UTC multiples of 10s; last completed S5 close carried between events',
               'poll_5': 'Same with 5-second phase offset', 'touch': 'Immediate favorable quote touch activates BE; sensitivity only, not actual app behavior',
               'no_be': 'No breakeven protection; separate exit-policy diagnostic, not an execution bound'},
        validations=validations, baseline=baseline, results=rows, aggregates=grouped)


if __name__ == '__main__':
    with gzip.open(BASE / 'market.json.gz', 'rt') as f:
        market = json.load(f)
    inputs = json.loads((BASE / 'exit_inputs.json').read_text())
    with gzip.open(BASE / 'signal_inputs.json.gz', 'rt') as f:
        signals = json.load(f)
    output = analyze(inputs, market, signals)
    (BASE / 'exit_results.json').write_text(json.dumps(output, indent=2) + '\n')
    print('Trades:', len(inputs), 'baseline exit classes matched:', sum(b['class_match'] for b in output['baseline']))
    for r in output['aggregates']:
        if r['cohort'] in ('recent', 'earlier') and r['subset'] == 'all_trades' and r['mode'] == 'poll_0':
            print(r['cohort'], r['family'], r['multiplier'], r['cash_proxy_aud'], r['positive_all_paths'], r['negative_all_paths'])
