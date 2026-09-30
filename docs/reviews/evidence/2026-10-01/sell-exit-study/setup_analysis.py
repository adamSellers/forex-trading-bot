#!/usr/bin/env python3
"""Descriptive SELL setup audit; no optimization, orders, or source changes.

Refresh selected inputs: python3 setup_analysis.py --prepare /tmp/.../trades.json
Reproduce retained results: python3 setup_analysis.py
"""
import argparse
import collections
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import statistics
from zoneinfo import ZoneInfo

BASE = Path(__file__).resolve().parent
EARLIER_START = 1788652800000  # 2026-09-06T00:00:00Z
PRIMARY_START = 1789986900000  # previous review cutoff, 2026-09-21T10:35:00Z


def iso(ms, zone=timezone.utc):
    return datetime.fromtimestamp(ms / 1000, zone).isoformat()


def prepare(path):
    raw = path.read_bytes()
    source = json.loads(raw)
    rows = []
    for t in source['trades']:
        if t['entryTime'] < EARLIER_START:
            continue
        rt = t['brokerReconciliationPayload']['liveRuntime']
        ex = t['brokerReconciliationPayload'].get('sampledExcursion', {})
        telemetry = rt['entryTelemetry']
        ctx = telemetry['strategyContext']
        config = rt['exitConfig']
        row = {k: t.get(k) for k in ['oandaTradeId', 'instrument', 'side', 'signal',
            'entryType', 'entryTime', 'exitTime', 'entryPrice', 'exitPrice',
            'exitReason', 'pnlAud', 'pnlPips', 'units', 'isOpen']}
        row.update({
            'release': config['liveReleaseVersion'],
            'initialStopDistance': rt['initialStopDistance'],
            'initialStopLossPrice': rt['initialStopLossPrice'],
            'initialRiskAud': rt.get('initialRiskAud'),
            'entryTelemetry': {k: telemetry.get(k) for k in ['entryReferencePrice',
                'executablePrice', 'entrySlippagePips', 'finalSpreadPips']},
            'strategyContext': {k: ctx.get(k) for k in ['signalCandleCloseTime',
                'activeSessions', 'h1', 'm15', 'costs', 'reentry', 'lossReset']},
            'sampledExcursion': {k: ex.get(k) for k in ['version', 'lifetimeStatus',
                'maxFavorableR', 'maxAdverseR', 'observations']},
        })
        # Earlier excursion version 1 is known to include post-close samples.
        if ex.get('version') != 2 or ex.get('lifetimeStatus') != 'VERIFIED':
            row['sampledExcursion']['maxFavorableR'] = None
            row['sampledExcursion']['maxAdverseR'] = None
        rows.append(row)
    result = {
        'source': 'Read-only current local API trade capture; selected fields only',
        'source_sha256': hashlib.sha256(raw).hexdigest(),
        'earlier_start_utc': iso(EARLIER_START),
        'primary_start_utc': iso(PRIMARY_START),
        'trades': sorted(rows, key=lambda r: r['entryTime']),
    }
    (BASE / 'setup_inputs.json').write_text(json.dumps(result, indent=2) + '\n')


def describe(rows):
    return {
        'count': len(rows),
        'positive': sum(r['pnl_aud'] > 0 for r in rows),
        'negative': sum(r['pnl_aud'] < 0 for r in rows),
        'flat': sum(r['pnl_aud'] == 0 for r in rows),
        'pnl_aud': round(sum(r['pnl_aud'] for r in rows), 4),
        'exits': dict(collections.Counter(r['exit_reason'] for r in rows)),
        'entry_ema20_distance_atr_median': statistics.median(
            r['entry_below_m15_ema20_atr'] for r in rows) if rows else None,
        'trade_ids': [r['broker_trade_id'] for r in rows],
    }


def grouped(rows, key):
    groups = collections.defaultdict(list)
    for row in rows:
        groups[row[key]].append(row)
    return {k: describe(v) for k, v in groups.items()}


def analyze(data):
    rows = []
    previous_by_pair = {}
    for t in data['trades']:
        previous = previous_by_pair.get(t['instrument'])
        previous_by_pair[t['instrument']] = t
        if t['side'] != 'SELL':
            continue
        assert t['isOpen'] is False
        ctx = t['strategyContext']
        m, h = ctx['m15'], ctx['h1']
        trigger = m['trigger']
        combo = ('both' if trigger['shortPullback'] and trigger['shortBreakout']
                 else 'pullback_only' if trigger['shortPullback']
                 else 'breakout_only' if trigger['shortBreakout'] else 'neither')
        reentry = ctx.get('reentry') or {}
        loss_reset = ctx.get('lossReset') or {}
        pip = .01 if t['instrument'].endswith('JPY') else .0001
        entry = t['entryPrice']
        row = {
            'broker_trade_id': t['oandaTradeId'],
            'instrument': t['instrument'], 'release': t['release'],
            'primary_cohort': t['entryTime'] >= PRIMARY_START,
            'entry_utc': iso(t['entryTime']),
            'entry_sydney': iso(t['entryTime'], ZoneInfo('Australia/Sydney')),
            'exit_utc': iso(t['exitTime']),
            'entry_price': entry, 'exit_price': t['exitPrice'],
            'pnl_aud': t['pnlAud'], 'pnl_pips': t['pnlPips'],
            'exit_reason': t['exitReason'],
            'holding_minutes': (t['exitTime'] - t['entryTime']) / 60000,
            'entry_type': t['entryType'], 'trigger_combination': combo,
            'source_signal_side': t['signal'], 'executed_side': t['side'],
            'recorded_original_side': reentry.get('originalSide'),
            'recorded_executed_side': reentry.get('executedSide'),
            'is_post_tp_fade': t['entryType'] == 'M15_POST_TP_FADE',
            'initial_stop_price_recorded': t['initialStopLossPrice'],
            'initial_stop_distance_pips_recorded': t['initialStopDistance'] / pip,
            'm15_atr_pips': m['atr'] / pip, 'm15_rsi': m['rsi'],
            'h1_adx': h['adx'], 'h1_minus_di': h['mdi'], 'h1_plus_di': h['pdi'],
            'h1_bearish_di_margin': h['mdi'] - h['pdi'],
            'h1_short_regime': h['shortRegime'],
            'h1_close_below_ema20_pips': (h['fastEma'] - h['close']) / pip,
            'm15_body_ratio': m['bodyRatio'], 'm15_range_atr': m['rangeAtr'],
            'signal_below_m15_ema20_pips': (m['fastEma'] - m['close']) / pip,
            'signal_below_m15_ema20_atr': (m['fastEma'] - m['close']) / m['atr'],
            'entry_below_m15_ema20_pips': (m['fastEma'] - entry) / pip,
            'entry_below_m15_ema20_atr': (m['fastEma'] - entry) / m['atr'],
            'entry_below_m15_ema50_pips': (m['slowEma'] - entry) / pip,
            'entry_below_prior8_low_pips': (trigger['breakoutLow'] - entry) / pip,
            'entry_to_prior8_high_pips': (trigger['breakoutHigh'] - entry) / pip,
            'signal_close_to_entry_down_pips': (m['close'] - entry) / pip,
            'entry_seconds_after_signal_close':
                (t['entryTime'] - ctx['signalCandleCloseTime']) / 1000,
            'final_spread_pips': t['entryTelemetry']['finalSpreadPips'],
            'entry_slippage_pips': t['entryTelemetry']['entrySlippagePips'],
            'cost_to_stop_ratio': ctx['costs']['costToStopRatio'],
            'sampled_mfe_r_verified': t['sampledExcursion']['maxFavorableR'],
            'sampled_mae_r_verified': t['sampledExcursion']['maxAdverseR'],
            'same_pair_previous': None if previous is None else {
                'broker_trade_id': previous['oandaTradeId'],
                'side': previous['side'], 'exit_reason': previous['exitReason'],
                'gap_minutes': (t['entryTime'] - previous['exitTime']) / 60000,
            },
            'reentry_classification': reentry.get('classification'),
            'reentry_fresh_touch_recorded': reentry.get('freshTouch'),
            'reentry_freshness_was_applicable': bool(reentry.get('anchor') and
                reentry['anchor']['side'] == reentry.get('originalSide') and
                reentry['anchor']['exitReason'] in ['TAKE_PROFIT', 'BREAKEVEN_STOP']),
            'loss_reset_classification': loss_reset.get('classification'),
            'loss_reset_state': loss_reset.get('state'),
        }
        if loss_reset.get('state') and loss_reset['state'].get('rearmedAt'):
            row['hours_since_h1_loss_reset_rearmed'] = (
                t['entryTime'] - loss_reset['state']['rearmedAt']) / 3600000
        rows.append(row)
    primary = [r for r in rows if r['primary_cohort']]
    earlier = [r for r in rows if not r['primary_cohort']]
    assert len(rows) == 29 and len(primary) == 13 and len(earlier) == 16
    assert all(r['source_signal_side'] == r['executed_side'] == 'SELL' for r in rows)
    assert all(not r['is_post_tp_fade'] and r['h1_short_regime'] for r in rows)
    return {
        'primary': {'summary': describe(primary), 'by_release': grouped(primary, 'release'),
                    'by_trigger': grouped(primary, 'trigger_combination'),
                    'by_exit': grouped(primary, 'exit_reason')},
        'earlier_reference': {'summary': describe(earlier),
                              'by_release': grouped(earlier, 'release'),
                              'by_trigger': grouped(earlier, 'trigger_combination')},
        'trades': rows,
        'measurement_notes': [
            'Distances are descriptive midpoint-indicator to executable bid-fill comparisons; spread is not removed.',
            'Recorded original-stop distance is not asserted equal to rounded broker order risk in older releases.',
            'Previous same-pair entry includes BUY trades; anchor is the observed history, not counterfactual history.',
            'Earlier version-1 excursion aggregates are intentionally suppressed because they can include post-close samples.',
            'Only current releases record original/executed-side provenance; older rows retain SELL source signal and SELL fill.',
            'A false freshTouch default after a STOP_LOSS does not prove no actual touch; this branch did not evaluate freshness.',
            'H1 RSI is not retained by this strategy; H1 ADX and DI are retained, while RSI is M15.',
            'No distance, RSI, ADX or stop-width threshold was fitted to outcomes; small release cohorts are not causal comparisons.',
        ],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare', type=Path)
    args = parser.parse_args()
    if args.prepare:
        prepare(args.prepare)
    result = analyze(json.loads((BASE / 'setup_inputs.json').read_text()))
    (BASE / 'setup_results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'trades'}, indent=2))
