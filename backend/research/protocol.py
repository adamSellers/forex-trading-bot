#!/usr/bin/env python3
"""Validate prespecified research protocols and append a local trial ledger.

The ledger records assertions and hashes, not proof that outcomes were unseen.
It does not grant entry permission or promote/deploy a strategy.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path


def stamp(value):
    if not isinstance(value, str):
        raise ValueError("Period boundaries must be explicit timezone-aware ISO strings")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Period boundaries must include a timezone")
    return parsed


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate(spec, registered_at=None):
    registered_at = registered_at or datetime.now(timezone.utc)
    if spec.get("schemaVersion") != 1:
        raise ValueError("Unsupported protocol schema")
    for key in ("candidateId", "hypothesis", "baselineIdentity", "dataManifestSha256",
                "entryPolicy", "exitPolicy", "featuresKnownAtDecision", "costCases",
                "economicObjectives", "uncertaintyMethod", "trialBudget", "periods",
                "labelPolicy", "evaluationUse"):
        if not spec.get(key):
            raise ValueError(f"Missing explicit protocol field: {key}")
    if spec["evaluationUse"] not in ("RETROSPECTIVE", "FUTURE_UNTOUCHED"):
        raise ValueError("evaluationUse must distinguish retrospective from future untouched evidence")
    manifest_hash = spec["dataManifestSha256"]
    if not isinstance(manifest_hash, str) or len(manifest_hash) != 64 or any(c not in "0123456789abcdef" for c in manifest_hash):
        raise ValueError("dataManifestSha256 must identify the frozen input manifest")
    budget = spec["trialBudget"]
    if not isinstance(budget, dict) or not isinstance(budget.get("maximumVariants"), int) or isinstance(budget.get("maximumVariants"), bool) or budget["maximumVariants"] < 1 or not budget.get("selectionRule"):
        raise ValueError("trialBudget requires a positive maximumVariants and an explicit selectionRule")
    if not isinstance(spec["periods"], list):
        raise ValueError("periods must be an explicit ordered list")
    previous_end = None
    final_periods = []
    for period in spec["periods"]:
        start, end = stamp(period.get("fromUtc")), stamp(period.get("toUtcExclusive"))
        if start >= end or (previous_end is not None and start < previous_end):
            raise ValueError("Period boundaries must be chronological and nonoverlapping")
        previous_end = end
        if period.get("role") not in ("DEVELOPMENT", "VALIDATION", "FINAL_EVALUATION"):
            raise ValueError("Unknown period role")
        if period["role"] == "FINAL_EVALUATION":
            final_periods.append((period, start))
    if not final_periods:
        raise ValueError("Specify a final evaluation period, including its retrospective/future status")
    if spec["evaluationUse"] == "FUTURE_UNTOUCHED":
        if not spec.get("outcomeAccessPolicy"):
            raise ValueError("Future protocols need an explicit outcome-access and reveal policy")
        for period, start in final_periods:
            if start <= registered_at or period.get("alreadyInspected") is not False:
                raise ValueError("A final interval already begun/inspected cannot be relabelled future untouched")
    return {"valid": True, "candidateId": spec["candidateId"], "evaluationUse": spec["evaluationUse"],
            "limits": "Protocol/ledger metadata cannot prove that nobody inspected outcomes or validate a profitability claim."}


def append_event(path, event):
    path = Path(path)
    ledger = json.loads(path.read_text()) if path.exists() else {"schemaVersion": 1, "events": []}
    if ledger.get("schemaVersion") != 1 or not isinstance(ledger.get("events"), list):
        raise ValueError("Unsupported trial ledger")
    if event["kind"] == "REGISTERED" and any(row.get("kind") == "REGISTERED" and row.get("candidateId") == event["candidateId"] for row in ledger["events"]):
        raise ValueError("Candidate ID already registered; use a new identity for a changed specification")
    if event["kind"] != "REGISTERED" and not any(row.get("kind") == "REGISTERED" and row.get("candidateId") == event["candidateId"] for row in ledger["events"]):
        raise ValueError("Record the protocol before recording its result or abandonment")
    ledger["events"].append(event)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    for name in ("validate", "register"):
        command = sub.add_parser(name)
        command.add_argument("spec", type=Path)
        if name == "register":
            command.add_argument("--ledger", required=True, type=Path)
    command = sub.add_parser("result")
    command.add_argument("candidate_id")
    command.add_argument("--ledger", required=True, type=Path)
    command.add_argument("--artifact", required=True, type=Path)
    command.add_argument("--status", required=True, choices=("SUPPORTED", "REJECTED", "INCONCLUSIVE", "ABANDONED"))
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    if args.operation in ("validate", "register"):
        spec = json.loads(args.spec.read_text())
        result = validate(spec, now)
        if args.operation == "register":
            append_event(args.ledger, {"kind": "REGISTERED", "registeredAtUtc": now.isoformat(),
                                      "candidateId": spec["candidateId"], "specSha256": sha(args.spec),
                                      "protocol": spec})
    else:
        append_event(args.ledger, {"kind": "RESULT_RECORDED", "recordedAtUtc": now.isoformat(),
                                  "candidateId": args.candidate_id, "status": args.status,
                                  "artifactSha256": sha(args.artifact), "artifact": str(args.artifact)})
        result = {"recorded": True, "candidateId": args.candidate_id, "status": args.status}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
