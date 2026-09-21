#!/usr/bin/env python3
"""Regression for an exit-straddling candle whose stop-touch time is unknown."""
import copy
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).parent


class PartialExitBarTest(unittest.TestCase):
    def test_breakeven_touch_in_partial_start_bar_is_rejected(self):
        inputs = json.loads((HERE / 'inputs.json').read_text())
        original_market = json.loads((HERE / 'market-data.json').read_text())
        trade = next(t for t in inputs['trades'] if t['id'] == '3073')
        entry = trade['entry_price']
        distance = trade['initial_stop_distance']
        to_ms = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000
        for also_touches_target in (False, True):
            with self.subTest(also_touches_target=also_touches_target), tempfile.TemporaryDirectory() as tmp:
                market = copy.deepcopy(original_market)
                boundary = next(c for c in market['M1']['3073']['data']['candles']
                                if to_ms(c['time']) < trade['exit_time'] < to_ms(c['time']) + 60_000)
                # SELL exit uses ask. The candle certainly touches BE, but its
                # OHLC cannot say whether this happened before or after the TP.
                boundary['ask'] = {
                    'o': f'{entry - 1.5 * distance:.3f}',
                    'h': f'{entry:.3f}',
                    'l': f'{entry - (2.2 if also_touches_target else 1.6) * distance:.3f}',
                    'c': f'{entry - 1.5 * distance:.3f}',
                }
                market_path = Path(tmp) / 'market.json'
                output_path = Path(tmp) / 'results.json'
                market_path.write_text(json.dumps(market))
                result = subprocess.run(
                    [sys.executable, str(HERE / 'analyze.py'), '--market-data', str(market_path),
                     '--output', str(output_path)], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Partial starting bar touches breakeven', result.stderr)
                self.assertFalse(output_path.exists())


if __name__ == '__main__':
    unittest.main()
