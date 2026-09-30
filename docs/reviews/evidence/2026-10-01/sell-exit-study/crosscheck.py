#!/usr/bin/env python3
"""Independent arithmetic and observed-entry capacity audit; no replay imports.

This checks saved analysis output, not broker execution fidelity. The optional
raw API snapshot path supplies observed BUY as well as SELL entry times.
"""
from collections import Counter
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP
import gzip
import hashlib
import json
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
inputs = json.loads((BASE / 'exit_inputs.json').read_text())
saved = json.loads((BASE / 'exit_results.json').read_text())
with gzip.open(BASE / 'market.json.gz', 'rt') as stream:
    market = json.load(stream)
if len(sys.argv) > 1:
    raw_path = Path(sys.argv[1])
    raw_source = json.loads(raw_path.read_text())['trades']
    fields = ('oandaTradeId', 'instrument', 'side', 'entryTime', 'exitTime', 'pnlAud', 'entryPrice', 'exitPrice', 'units')
    raw = [{**{key: t[key] for key in fields}, 'release':
            (t.get('brokerReconciliationPayload') or {}).get('liveRuntime', {}).get('exitConfig', {}).get('liveReleaseVersion')}
           for t in raw_source if t['entryTime'] >= min(x['entryTime'] for x in inputs)]
    retained = {'raw_api_snapshot_sha256': hashlib.sha256(raw_path.read_bytes()).hexdigest(), 'trades': raw}
    (BASE / 'crosscheck_inputs.json').write_text(json.dumps(retained, indent=2) + '\n')
else:
    retained = json.loads((BASE / 'crosscheck_inputs.json').read_text())
    raw = retained['trades']
by_id = {t['id']: t for t in inputs}
raw_by_id = {t['oandaTradeId']: t for t in raw}
D = lambda value: Decimal(str(value))


def equal(left, right, tolerance=1e-9):
    assert abs(float(left) - float(right)) <= tolerance, (left, right)


def quantize(value, precision):
    return value.quantize(D(10) ** -precision, rounding=ROUND_HALF_UP)


actual = []
for t in inputs:
    broker = market['trades'][t['id']]
    api = raw_by_id[t['id']]
    equal(t['pnlAud'], D(broker['realizedPL']) + D(broker['financing']))
    equal(t['pnlAud'], api['pnlAud'])
    equal(t['entryPrice'], broker['price'])
    equal(t['exitPrice'], broker['averageClosePrice'])
    equal(t['units'], abs(D(broker['initialUnits'])))
    actual.append({'id': t['id'], 'primary': t['primary'], 'net_aud': t['pnlAud'],
                   'broker_and_api_match': True})

risk_ratios = []
for row in saved['results']:
    t = by_id[row['id']]
    distance = D(row['original_stop']) - D(t['entryPrice'])
    new_stop = quantize(D(t['entryPrice']) + distance * D(row['multiplier']), t['precision'])
    new_distance = new_stop - D(t['entryPrice'])
    units = int((D(t['units']) * distance / new_distance).to_integral_value(rounding=ROUND_FLOOR))
    assert row['units'] == units
    equal(row['stop'], new_stop)
    risk = D(t['units']) * distance * D(t['lossConversion'])
    resized_risk = D(units) * new_distance * D(t['lossConversion'])
    assert resized_risk <= risk
    equal(row['original_risk_aud'], risk)
    equal(row['resized_risk_aud'], resized_risk)
    risk_ratios.append(float(resized_risk / risk))
    if row['family'] == 'fixed' or row['multiplier'] == 1:
        equal(row['target'], row['original_target'])
        equal(row['be_trigger'], D(t['entryPrice']) - D(t['initialDistance']))
    else:
        equal(row['target'], quantize(D(t['entryPrice']) - new_distance * D('1.5'), t['precision']))
        equal(row['be_trigger'], D(t['entryPrice']) - new_distance)
    for outcome in row['outcomes']:
        move = D(t['entryPrice']) - D(outcome['price'])
        conversion = D(t['gainConversion'] if move > 0 else t['lossConversion'])
        equal(outcome['cash_proxy_aud'], move * D(units) * conversion)
        equal(outcome['unchanged_units_cash_proxy_aud'], move * D(t['units']) * conversion)
        equal(outcome['resized_risk_r'], move * D(units) / (distance * D(t['units'])))
        equal(outcome['original_price_r'], move / distance)
        equal(outcome['pips'], move / D(t['pipSize']))
        assert t['entryTime'] <= outcome['earliest'] <= outcome['latest'] <= t['deadline']

for aggregate in saved['aggregates']:
    eligible = {t['id'] for t in inputs
                if (aggregate['cohort'] == 'all' or t['primary'] == (aggregate['cohort'] == 'recent'))
                and (aggregate['subset'] == 'all_trades' or
                     (t['pnlAud'] < 0) == (aggregate['subset'] == 'actual_negative'))}
    rows = [r for r in saved['results'] if r['id'] in eligible and
            all(r[k] == aggregate[k] for k in ['family', 'multiplier', 'mode'])]
    assert len(rows) == aggregate['count']
    for key in ['cash_proxy_aud', 'unchanged_units_cash_proxy_aud', 'resized_risk_r']:
        equal(aggregate[key]['low'], sum(min(o[key] for o in row['outcomes']) for row in rows))
        equal(aggregate[key]['high'], sum(max(o[key] for o in row['outcomes']) for row in rows))
    assert aggregate['positive_all_paths'] == sum(min(o['cash_proxy_aud'] for o in row['outcomes']) > 1e-9 for row in rows)
    assert aggregate['negative_all_paths'] == sum(max(o['cash_proxy_aud'] for o in row['outcomes']) < -1e-9 for row in rows)
    assert aggregate['zero_all_paths'] == sum(all(abs(o['cash_proxy_aud']) < 1e-9 for o in row['outcomes']) for row in rows)

conflicts = []
for row in saved['results']:
    if row['multiplier'] == 1 or row['mode'] not in ('poll_0', 'poll_5'):
        continue
    t = by_id[row['id']]
    earliest = min(o['earliest'] for o in row['outcomes'])
    latest = max(o['latest'] for o in row['outcomes'])
    for following in raw:
        if not t['exitTime'] < following['entryTime'] < latest:
            continue
        release = following['release']
        assert release is not None, following['oandaTradeId']
        per_pair = release in ('m15-intraday-v4.1', 'm15-intraday-v4.2')
        if per_pair and t['instrument'] != following['instrument']:
            continue
        conflicts.append({'held_id': t['id'], 'held_instrument': t['instrument'],
            'primary': t['primary'], 'following_id': following['oandaTradeId'],
            'following_instrument': following['instrument'], 'following_side': following['side'],
            'following_entry_time': following['entryTime'], 'following_release': release,
            'capacity': 'one_per_pair' if per_pair else 'one_globally',
            'family': row['family'], 'multiplier': row['multiplier'], 'mode': row['mode'],
            'certainty_within_model': 'definite' if following['entryTime'] < earliest else 'possible',
            'model_earliest_exit': earliest, 'model_latest_exit': latest})

all_table = []
phase_differences = []
for t in inputs:
    columns = []
    for family in ('fixed', 'scaled'):
        for multiplier in (1.25, 1.5, 2):
            phases = {mode: next(r for r in saved['results'] if
                      (r['id'], r['family'], r['multiplier'], r['mode']) == (t['id'], family, multiplier, mode))
                      for mode in ('poll_0', 'poll_5')}
            signatures = {mode: sorted({(o['kind'], round(o['price'], 8)) for o in row['outcomes']})
                          for mode, row in phases.items()}
            if signatures['poll_0'] != signatures['poll_5']:
                phase_differences.append({'id': t['id'], 'primary': t['primary'], 'family': family, 'multiplier': multiplier,
                                          'phase_outcomes': signatures})
            row = phases['poll_0']
            columns.append({'family': family, 'multiplier': multiplier, 'units': row['units'],
                'kinds': sorted({o['kind'] for o in row['outcomes']}),
                'cash_proxy_aud': {'low': min(o['cash_proxy_aud'] for o in row['outcomes']),
                                   'high': max(o['cash_proxy_aud'] for o in row['outcomes'])}})
    all_table.append({'id': t['id'], 'primary': t['primary'], 'instrument': t['instrument'], 'actual_pnl_aud': t['pnlAud'],
                         'actual_exit': t['exitReason'], 'comparisons': columns})

summary = []
for cohort in ('recent', 'earlier', 'all'):
    rows = [t for t in inputs if cohort == 'all' or t['primary'] == (cohort == 'recent')]
    summary.append({'cohort': cohort, 'count': len(rows), 'actual_net_aud': float(sum(D(t['pnlAud']) for t in rows)),
                    'positive': sum(t['pnlAud'] > 0 for t in rows), 'negative': sum(t['pnlAud'] < 0 for t in rows),
                    'zero': sum(t['pnlAud'] == 0 for t in rows),
                    'exit_counts': dict(Counter(t['exitReason'] for t in rows))})

output = {'method': 'independent_saved_output_arithmetic_and_capacity_audit_v1',
    'limitations': ['Does not certify hypothetical execution fills or the S5 replay implementation.',
                    'Capacity conflicts assume the held trade was entered; competing hypothetical earlier holds are not resolved.',
                    'Counterfactual signal, cooldown, H1 reset and new-entry regeneration are not simulated.',
                    'Conditional individual-trade sums are not portfolio returns.'],
    'source_sha256': {name: hashlib.sha256((BASE / name).read_bytes()).hexdigest() for name in
                      ('exit_inputs.json', 'exit_results.json', 'market.json.gz', 'signal_inputs.json.gz', 'crosscheck_inputs.json')},
    'raw_api_snapshot_sha256': retained['raw_api_snapshot_sha256'],
    'checks': {'actual_broker_api_reconciliations': len(actual), 'size_and_outcome_rows': len(saved['results']),
               'aggregates': len(saved['aggregates']), 'nominal_risk_ratio_min': min(risk_ratios),
               'nominal_risk_ratio_max': max(risk_ratios),
               'baseline_class_matches': sum(b['class_match'] for b in saved['baseline'])},
    'actual_summary': summary, 'actual_reconciliations': actual,
    'all_table_poll_0': all_table, 'recent_table_poll_0': [t for t in all_table if t['primary']],
    'all_phase_differences': phase_differences,
    'recent_phase_differences': [p for p in phase_differences if p['primary']],
    'observed_entry_capacity_conflicts': conflicts}
(BASE / 'crosscheck.json').write_text(json.dumps(output, indent=2) + '\n')
print(json.dumps({k: output[k] for k in ['checks', 'actual_summary', 'recent_phase_differences']}, indent=2))
print('Capacity conflicts:', len(conflicts))
