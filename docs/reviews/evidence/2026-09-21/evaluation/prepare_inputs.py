#!/usr/bin/env python3
"""Create minimal, account-free evidence from the retained read-only audit exports."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--production', type=Path, required=True)
parser.add_argument('--broker', type=Path, required=True)
parser.add_argument('--candles', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, default=Path(__file__).parent)
args = parser.parse_args()
x = json.loads(args.production.read_text())
b = json.loads(args.broker.read_text())
candles = json.loads(args.candles.read_text())
parse = lambda value: json.loads(value) if isinstance(value, str) else value
intents = {i['trade_id']: i for i in x['intents'] if i['trade_id']}
rows = []
for trade in sorted(x['trades'], key=lambda t: t['entry_time']):
    context = parse(intents[trade['trade_id']]['context_payload'])
    runtime = parse(trade['broker_reconciliation_payload'])['liveRuntime']
    signal = context['signal']
    strategy_context = signal.get('strategyContext') or signal['decisionContext']['strategyContext']
    rows.append({
        'id': trade['oanda_trade_id'],
        **{k: trade[k] for k in ('instrument', 'side', 'entry_time', 'exit_time',
                                'entry_price', 'exit_price', 'exit_reason', 'pnl_aud', 'pnl_pips')},
        'initial_stop_distance': runtime['initialStopDistance'],
        'release': context['config']['liveReleaseVersion'],
        'signal_context': strategy_context,
        'time_stop_hours': runtime['exitConfig']['timeStopHours'],
        'stop_orders': [{k: tx[k] for k in ('id', 'time', 'price', 'reason')}
                        for tx in b['transactions']
                        if tx['type'] == 'STOP_LOSS_ORDER' and tx.get('tradeID') == trade['oanda_trade_id']],
    })
# Retain each distinct completed-candle H1 observation, including missing H1
# context as unknown. This preserves enough evidence to identify observed resets
# without retaining 46,040 operational scan records or personal configuration.
seen = set()
observations = []
for signal in x['signals']:
    context = parse(signal['decision_context']).get('strategyContext', {})
    h1 = context.get('h1')
    if not h1:
        continue
    regime = 1 if h1['longRegime'] else -1 if h1['shortRegime'] else 0
    key = (signal['instrument'], signal['signal_candle_time'], regime)
    if key in seen:
        continue
    seen.add(key)
    observations.append({'instrument': signal['instrument'], 'timestamp': signal['timestamp'],
                         'signal_candle_time': signal['signal_candle_time'], 'regime': regime})
# Decisions are evidence of observed attempts, not hypothetical fills.
decisions = [{k: d[k] for k in ('setup_id', 'decision_time', 'instrument', 'side', 'outcome',
                               'rejection_code')} for d in x['decisions']]
inputs = {'review_start_ms': x['start_ms'], 'review_end_ms': x['end_ms'],
          'trades': rows, 'regime_observations': observations, 'decisions': decisions}
args.output_dir.mkdir(parents=True, exist_ok=True)
(args.output_dir / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
(args.output_dir / 'market-data.json').write_text(json.dumps(candles, separators=(',', ':')) + '\n')
manifest = {'description': 'Read-only broker candles and minimal saved-entry/decision evidence; no account identifiers or secrets.',
            'source_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in (args.production, args.broker, args.candles)},
            'candle_capture_time': candles['captured_at'],
            'trades': len(rows), 'regime_observations': len(observations), 'decisions': len(decisions)}
(args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
