#!/usr/bin/env python3
"""Locate actual initial SELL stops relative to retained entry-time structure.

Descriptive only: no structural stop is proposed or replayed. Midpoint swing
levels are not equivalent to executable ask stops, and no buffer is invented.
"""
from datetime import datetime
import gzip
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
OLDER = BASE.parents[1] / '2026-09-26' / 'broker-evidence.json'
PRIMARY_START = 1789986900000


def ms(s):
    return round(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)


def summary(rows):
    return {'count': len(rows),
        'stop_inside_prior4_midpoint_range_count': sum(r['stop_inside_prior4_midpoint_range'] for r in rows), **{
        'stop_below_' + key + '_count': sum(r['stop_below_' + key] for r in rows)
        for key in ['m15_ema20', 'm15_ema50', 'prior4_high', 'prior8_high']}}


def analyze():
    inputs = json.loads((BASE / 'setup_inputs.json').read_text())
    market = json.loads(gzip.decompress((BASE / 'market.json.gz').read_bytes()))
    older = json.loads(OLDER.read_text())
    rows = []
    for t in inputs['trades']:
        if t['side'] != 'SELL' or t['entryTime'] < PRIMARY_START:
            continue
        tid = t['oandaTradeId']
        ctx = t['strategyContext']
        m = ctx['m15']
        signal_start = ctx['signalCandleCloseTime'] - 900000
        pip = .01 if t['instrument'].endswith('JPY') else .0001
        orders = sorted((x for x in market['transactions'] if
            x.get('tradeID') == tid and x['type'] == 'STOP_LOSS_ORDER' and
            t['entryTime'] - 1 <= ms(x['time']) <= t['entryTime'] + 5000),
            key=lambda x: (ms(x['time']), int(x['id'])))
        assert orders and orders[0]['reason'] == 'ON_FILL'
        # Preserve the broker's immediate fill-aligned replacement, before BE.
        stop = float(orders[-1]['price'])
        entry = float(market['trades'][tid]['price'])
        assert abs(entry - t['entryPrice']) < 1e-12 and stop > entry
        bars = m.get('pullbackWindow')
        source = 'recorded_entry_pullback_window'
        if bars is None:
            source = 'retained_2026-09-26_OANDA_M15_midpoint_candles'
            bars = [{'time': b['time'], 'high': float(b['mid']['h']),
                     'low': float(b['mid']['l'])}
                    for b in older['M15'][t['instrument']]['data']['candles']
                    if b['complete'] and signal_start - 4 * 900000 <= ms(b['time']) < signal_start]
        assert len(bars) == 4
        assert [ms(b['time']) for b in bars] == list(range(signal_start - 4 * 900000, signal_start, 900000))
        high4 = max(b['high'] for b in bars)
        low4 = min(b['low'] for b in bars)
        high8 = m['trigger']['breakoutHigh']
        assert high4 <= high8 + 1e-12
        levels = {'m15_ema20': m['fastEma'], 'm15_ema50': m['slowEma'],
                  'prior4_high': high4, 'prior8_high': high8}
        row = {
            'broker_trade_id': tid, 'instrument': t['instrument'],
            'release': t['release'], 'exit_reason': t['exitReason'],
            'pnl_aud': t['pnlAud'], 'entry': entry,
            'initial_stop': stop, 'initial_stop_order_id': orders[-1]['id'],
            'initial_stop_order_time': orders[-1]['time'],
            'actual_initial_risk_pips': (stop - entry) / pip,
            'prior4_source': source, 'prior4_bars': bars,
            'prior4_low': low4, 'stop_inside_prior4_midpoint_range': low4 <= stop <= high4,
        }
        for name, level in levels.items():
            row[name] = level
            row['stop_below_' + name] = stop < level
            row[name + '_above_stop_pips'] = (level - stop) / pip
            row['entry_to_' + name + '_pips'] = (level - entry) / pip
            row['entry_to_' + name + '_original_risk_multiple'] = (level - entry) / (stop - entry)
        rows.append(row)
    assert len(rows) == 13
    return {
        'summary': summary(rows),
        'initial_stop_losses': summary([r for r in rows if r['exit_reason'] == 'STOP_LOSS']),
        'target_winners': summary([r for r in rows if r['exit_reason'] == 'TAKE_PROFIT']),
        'trades': rows,
        'source_sha256': {str(p.name): hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in [BASE / 'setup_inputs.json', BASE / 'market.json.gz', OLDER]},
        'limitations': [
            'EMA and preceding highs are recorded midpoint levels; a SELL protective stop triggers on ask.',
            'No spread buffer, stop precision candidate or structural stop rule was selected or tested.',
            'Below a preceding high describes geometry, not probability of a normal bounce or proof of invalidation.',
            'Initial stops below prior structure occur in both losses and the two target winners.',
            'Factor-widening and structural-stop policies are different experiments; neither result implies the other.',
        ],
    }


if __name__ == '__main__':
    result = analyze()
    (BASE / 'setup_structure.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'trades'}, indent=2))
