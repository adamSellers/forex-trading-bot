#!/usr/bin/env python3
"""Audit local research inputs without broker access or runtime imports.

Only observed coverage is measured. An absent candle is not, by itself, evidence
of a broker failure; quiet intervals, market closures and capture gaps differ.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARCHIVE = ROOT / "backend/data/historical/research_M15_MBA_20200101_20260803.json"
DEFAULT_OUTPUT = ROOT / "docs/reviews/evidence/2026-10-06/research/input-audit.json"
INTERVAL_SECONDS = 900


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def iso(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")


def location(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return str(Path(path).resolve())


def prices_valid(component):
    if not isinstance(component, dict):
        return False
    values = [component.get(key) for key in ("o", "h", "l", "c")]
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool)
               and math.isfinite(value) and value > 0 for value in values):
        return False
    opening, high, low, close = values
    return low <= opening <= high and low <= close <= high


def summarize_instrument(instrument, bars, declared_from, declared_to):
    months, components, completion = Counter(), Counter(), Counter()
    invalid, misaligned, nonordered, duplicates = [], [], [], []
    gaps, seen, previous = [], set(), None
    times, side_close_differences = [], []
    for index, bar in enumerate(bars):
        started = bar.get("time")
        if (not isinstance(started, (int, float)) or isinstance(started, bool)
                or not math.isfinite(started) or started != int(started)):
            invalid.append({"index": index, "reason": "INVALID_SECONDS_TIMESTAMP"})
            continue
        started = int(started)
        times.append(started)
        months[iso(started)[:7]] += 1
        if started % INTERVAL_SECONDS:
            misaligned.append(index)
        if started in seen:
            duplicates.append(index)
        seen.add(started)
        if previous is not None:
            if started <= previous:
                nonordered.append(index)
            elif started - previous > INTERVAL_SECONDS:
                gaps.append({"fromUtc": iso(previous + INTERVAL_SECONDS),
                             "toUtcExclusive": iso(started),
                             "absentGridSlots": (started - previous) // INTERVAL_SECONDS - 1})
        previous = started
        completion["explicit_complete" if bar.get("complete") is True else
                   "explicit_incomplete" if bar.get("complete") is False else
                   "not_retained_per_candle"] += 1
        for component in ("mid", "bid", "ask"):
            if prices_valid(bar.get(component)):
                components[component] += 1
            else:
                invalid.append({"index": index, "reason": "INVALID_OR_MISSING_OHLC", "component": component})
        if prices_valid(bar.get("bid")) and prices_valid(bar.get("ask")):
            pip = 0.01 if instrument.endswith("_JPY") else 0.0001
            side_close_differences.append((bar["ask"]["c"] - bar["bid"]["c"]) / pip)
    side_close_differences.sort()
    def percentile(probability):
        if not side_close_differences:
            return None
        return round(side_close_differences[int((len(side_close_differences) - 1) * probability)], 6)
    boundaries = []
    if times:
        if declared_from < min(times):
            boundaries.append({"fromUtc": iso(declared_from), "toUtcExclusive": iso(min(times)), "kind": "LEADING_UNOBSERVED"})
        if max(times) + INTERVAL_SECONDS < declared_to:
            boundaries.append({"fromUtc": iso(max(times) + INTERVAL_SECONDS), "toUtcExclusive": iso(declared_to), "kind": "TRAILING_UNOBSERVED"})
    return {
        "instrument": instrument, "candles": len(bars),
        "firstIntervalStartUtc": iso(min(times)) if times else None,
        "lastIntervalStartUtc": iso(max(times)) if times else None,
        "lastIntervalEndUtc": iso(max(times) + INTERVAL_SECONDS) if times else None,
        "validComponents": dict(components), "completionEvidence": dict(completion),
        "duplicateTimes": len(duplicates), "nonIncreasingTimes": len(nonordered),
        "misalignedStarts": len(misaligned), "invalidRowsOrComponents": len(invalid),
        "firstProblems": (invalid + [{"index": index, "reason": "MISALIGNED_START"} for index in misaligned]
                          + [{"index": index, "reason": "NON_INCREASING_START"} for index in nonordered])[:20],
        "candlesByMonthUtc": dict(sorted(months.items())),
        "unobservedIntervals": gaps, "unobservedBoundaryIntervals": boundaries,
        "absentGridSlotsBetweenObservedCandles": sum(gap["absentGridSlots"] for gap in gaps),
        "sideCloseDifferencePips": {"median": percentile(0.5), "p95": percentile(0.95),
            "negativeCount": sum(value < 0 for value in side_close_differences),
            "meaning": "Ask-component close minus bid-component close; components can close at different events. This is not a synchronous executable account spread."},
    }


def prior_results(directory):
    rows = []
    for path in sorted(Path(directory).glob("*.json")):
        saved = json.loads(path.read_text())
        rows.append({"path": location(path), "sha256": digest(path),
                     "generatedAt": saved.get("generatedAt"),
                     "evaluationUse": "ALREADY_INSPECTED_RETROSPECTIVE",
                     "sourceCodeRevisionRetained": saved.get("source", {}).get("revision"),
                     "periods": saved.get("periods", []),
                     "results": [{"variant": row.get("variant", {}).get("id"),
                                  "period": row.get("period"), "stress": row.get("stress"),
                                  "trades": row.get("statistics", {}).get("tradeCount"),
                                  "profitFactor": row.get("statistics", {}).get("profitFactor"),
                                  "netPnlAud": row.get("statistics", {}).get("netPnlAud"),
                                  "assumptions": row.get("assumptions", {})}
                                 for row in saved.get("results", [])]})
    return rows


def audit(archive, baseline, old_results):
    saved = json.loads(Path(archive).read_text())
    if saved.get("granularity") != "M15" or not isinstance(saved.get("candlesByInstrument"), dict):
        raise ValueError("Expected the retained M15 candlesByInstrument schema; no implicit adapter")
    start, end = saved.get("from"), saved.get("to")
    if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in (start, end)) or start > end:
        raise ValueError("Missing or invalid declared seconds bounds")
    instruments = [summarize_instrument(name, bars, start, end)
                   for name, bars in sorted(saved["candlesByInstrument"].items())]
    baseline_saved = json.loads(Path(baseline).read_text()) if baseline else None
    return {
        "schemaVersion": 1, "artifactKind": "LOCAL_INPUT_COVERAGE_AUDIT",
        "baseline": baseline_saved.get("baseline") if baseline_saved else None,
        "source": {"path": location(archive), "sha256": digest(archive),
                   "bytes": Path(archive).stat().st_size, "provider": saved.get("source"),
                   "downloadedAt": saved.get("downloadedAt"), "schemaVersion": saved.get("schemaVersion"),
                   "granularity": "M15", "priceComponentsDeclared": saved.get("pricingComponents"),
                   "completeCandlesOnlyDeclared": saved.get("completeCandlesOnly"),
                   "timestampUnit": "UNIX_SECONDS", "timestampMeaning": "INTERVAL_START",
                   "declaredFromUtc": iso(start), "declaredToUtc": iso(end),
                   "declaredToInclusivity": "UNVERIFIED; report actual last interval separately",
                   "evaluationUse": "DEVELOPMENT_OR_RETROSPECTIVE_ROBUSTNESS; ALL OLD HOLDOUT PERIODS ALREADY INSPECTED"},
        "tools": {"auditPath": location(__file__), "auditSha256": digest(__file__), "runtime": "Python 3 standard library"},
        "baselineInput": {"path": location(baseline), "sha256": digest(baseline)} if baseline else None,
        "coverage": {"instruments": len(instruments), "candles": sum(row["candles"] for row in instruments),
                     "structuralProblems": sum(row["duplicateTimes"] + row["nonIncreasingTimes"] + row["misalignedStarts"] + row["invalidRowsOrComponents"] for row in instruments)},
        "instruments": instruments, "previousResearch": prior_results(old_results),
        "limits": [
            "Unobserved intervals include possible closures, holidays, quiet intervals and capture gaps; this audit cannot distinguish them or diagnose a broker outage.",
            "Per-candle completion flags may not have been retained. The top-level completed-only claim is provenance, not independently verified completion evidence.",
            "M15 OHLC does not establish intrabar event ordering, exact account quotes/fills, ten-second breakeven polling, historical liquidity or financing.",
            "H1 reconstruction and contemporaneous AUD conversion parity have not yet been validated.",
            "Input validity does not establish strategy profitability. This artifact performs no strategy replay and generates no replacement fills.",
            "Reviewed September/October outcomes and all previous holdout results remain development/retrospective evidence; reserve future outcomes after candidate freeze for untouched evaluation.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--baseline", type=Path, default=ROOT / "docs/reviews/evidence/2026-10-06/planning-baseline.json")
    parser.add_argument("--prior-results", type=Path, default=ROOT / "backend/data/backtests")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = audit(args.archive, args.baseline, args.prior_results)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"output": str(args.output), "coverage": result["coverage"], "historicalUse": result["source"]["evaluationUse"]}))
    return 1 if result["coverage"]["structuralProblems"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
