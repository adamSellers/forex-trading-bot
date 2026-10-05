import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


audit = module("audit_inputs")
protocol = module("protocol")


def bar(timestamp):
    return {"time": timestamp, "complete": True, **{component: {"o": 1, "h": 1.1, "l": 0.9, "c": 1}
                                                  for component in ("mid", "bid", "ask")}}


def candidate():
    return {"schemaVersion": 1, "candidateId": "fixture", "hypothesis": "Fixture only",
            "baselineIdentity": {"revision": "fixture"}, "dataManifestSha256": "a" * 64,
            "entryPolicy": "unchanged", "exitPolicy": "unchanged",
            "featuresKnownAtDecision": ["completed bar"], "costCases": ["bid/ask"],
            "economicObjectives": ["net-R baseline comparison"], "uncertaintyMethod": "episode clusters",
            "trialBudget": {"maximumVariants": 1, "selectionRule": "retain all results"},
            "labelPolicy": "declare actual vs modelled", "evaluationUse": "FUTURE_UNTOUCHED",
            "outcomeAccessPolicy": "reveal after final interval closes",
            "periods": [{"role": "FINAL_EVALUATION", "fromUtc": "2027-01-01T00:00:00Z",
                         "toUtcExclusive": "2027-02-01T00:00:00Z", "alreadyInspected": False}]}


class CoverageTests(unittest.TestCase):
    def test_absent_intervals_are_coverage_not_failures(self):
        rows = [bar(0), bar(900), bar(3600)]
        result = audit.summarize_instrument("EUR_USD", rows, 0, 4500)
        self.assertEqual(result["invalidRowsOrComponents"], 0)
        self.assertEqual(result["absentGridSlotsBetweenObservedCandles"], 2)
        self.assertEqual(result["unobservedIntervals"][0]["toUtcExclusive"], "1970-01-01T01:00:00Z")
        self.assertNotIn("unhealthy", result)

    def test_broken_timestamps_and_components_are_recorded(self):
        rows = [bar(0), bar(0), bar(900)]
        rows[-1]["ask"]["h"] = 0.5
        result = audit.summarize_instrument("EUR_USD", rows, 0, 1800)
        self.assertEqual(result["duplicateTimes"], 1)
        self.assertEqual(result["nonIncreasingTimes"], 1)
        self.assertEqual(result["invalidRowsOrComponents"], 1)

    def test_per_bar_completion_is_not_invented(self):
        value = bar(0)
        del value["complete"]
        result = audit.summarize_instrument("USD_JPY", [value], 0, 900)
        self.assertEqual(result["completionEvidence"], {"not_retained_per_candle": 1})


class ProtocolTests(unittest.TestCase):
    def test_future_period_must_be_unstarted_and_uninspected(self):
        now = datetime(2026, 10, 6, tzinfo=timezone.utc)
        self.assertTrue(protocol.validate(candidate(), now)["valid"])
        with self.assertRaises(ValueError):
            protocol.validate(candidate(), datetime(2027, 1, 2, tzinfo=timezone.utc))
        value = candidate()
        value["periods"][0]["alreadyInspected"] = True
        with self.assertRaises(ValueError):
            protocol.validate(value, now)

    def test_overlap_and_unbounded_trials_are_rejected(self):
        value = candidate()
        value["periods"].append(copy.deepcopy(value["periods"][0]))
        with self.assertRaises(ValueError):
            protocol.validate(value)
        value = candidate()
        value["trialBudget"]["maximumVariants"] = 0
        with self.assertRaises(ValueError):
            protocol.validate(value)

    def test_ledger_preserves_registration_and_failed_trials(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.json"
            registered = {"kind": "REGISTERED", "candidateId": "fixture", "specSha256": "a" * 64}
            protocol.append_event(path, registered)
            with self.assertRaises(ValueError):
                protocol.append_event(path, registered)
            protocol.append_event(path, {"kind": "RESULT_RECORDED", "candidateId": "fixture", "status": "REJECTED"})
            self.assertEqual(json.loads(path.read_text())["events"], [registered, {"kind": "RESULT_RECORDED", "candidateId": "fixture", "status": "REJECTED"}])
            with self.assertRaises(ValueError):
                protocol.append_event(path, {"kind": "RESULT_RECORDED", "candidateId": "unregistered"})


if __name__ == "__main__":
    unittest.main()
